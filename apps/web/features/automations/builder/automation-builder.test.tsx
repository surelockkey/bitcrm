import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { AutomationRule, AutomationSpec } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { AutomationBuilderDialog, type AutomationDraft } from "./automation-builder";

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true, me: { id: "me" }, isLoading: false, isTechnician: false }),
}));

const TAG_ID = "11111111-1111-5111-8111-111111111111";

const rule: AutomationRule = {
  id: "scheduled",
  name: "Scheduled jobs",
  enabled: false,
  runnable: true,
  specSource: "workiz-translator",
  spec: {
    version: 1,
    trigger: { kind: "deal.updated" },
    conditions: [
      { field: "status", op: "in", values: ["submitted"], labels: ["Submitted"] },
      { field: "tag", op: "in", values: [TAG_ID], labels: ["SCHEDULED"] },
    ],
    actions: [{ type: "send_sms", to: "assigned_techs", body: "New scheduled job {{job_id}}" }],
    timing: { quietHours: "hold", workingHours: { from: "08:00", to: "18:00" } },
  },
  createdAt: "2026-09-15T10:00:00.000Z",
  updatedAt: "2026-09-15T10:00:00.000Z",
};

interface PatchBody {
  name?: string;
  spec?: AutomationSpec;
}
interface CreateBody extends PatchBody {
  enabled?: boolean;
  category?: string;
}
const patched: Array<{ id: string; body: PatchBody }> = [];
const created: CreateBody[] = [];
const tested: unknown[] = [];

beforeEach(() => {
  patched.length = 0;
  created.length = 0;
  tested.length = 0;
  server.use(
    http.patch("*/messaging/automations/:id", async ({ params, request }) => {
      patched.push({ id: String(params.id), body: (await request.json()) as PatchBody });
      return HttpResponse.json({ success: true, data: rule });
    }),
    http.post("*/messaging/automations", async ({ request }) => {
      created.push((await request.json()) as CreateBody);
      return HttpResponse.json({ success: true, data: { ...rule, id: "new-1" } });
    }),
    http.post("*/messaging/automations/:id/test", async ({ request }) => {
      tested.push(await request.json());
      return HttpResponse.json({
        success: true,
        data: {
          id: "run-test",
          ruleId: "scheduled",
          firedAt: "2026-09-16T15:04:00.000Z",
          trigger: "deal.updated",
          entity: "deal:d1",
          occurrence: "test",
          outcome: "dry_run",
          actions: [{ type: "send_sms", to: "tech Ann", outcome: "dry_run", body: "New scheduled job K4T9ZW" }],
        },
      });
    }),
    http.get("*/messaging/automations/:id/runs", () =>
      HttpResponse.json({
        success: true,
        data: [
          {
            id: "run-1",
            ruleId: "scheduled",
            firedAt: "2026-09-16T15:04:00.000Z",
            trigger: "deal.updated",
            entity: "deal:d1",
            occurrence: "o1",
            outcome: "sent",
            actions: [{ type: "send_sms", to: "tech Ann", outcome: "sent" }],
          },
        ],
      }),
    ),
  );
});

function renderBuilder(over: Partial<AutomationRule> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AutomationBuilderDialog
        rule={{ ...rule, ...over }}
        open
        labels={{ [TAG_ID]: "SCHEDULED" }}
        onOpenChange={() => {}}
      />
    </QueryClientProvider>,
  );
}

/** The other half of the contract: no rule, a recipe's draft or nothing. */
function renderCreate(draft?: AutomationDraft, onOpenChange: (open: boolean) => void = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AutomationBuilderDialog draft={draft} open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
}

/** The chain as a reader sees it, top to bottom. */
const chain = (): string[] =>
  screen
    .getAllByRole("button", { name: /^Step \d+, / })
    .map((b) => b.getAttribute("aria-label") as string);

/** Add a step at the "+" named `after`, choosing `option` from its menu. */
async function addStep(user: ReturnType<typeof userEvent.setup>, after: string, option: string) {
  await user.click(screen.getByRole("button", { name: after }));
  await user.click(await screen.findByRole("option", { name: new RegExp(option, "i") }));
}

describe("the chain", () => {
  it("reads the rule top to bottom: the trigger, what it checks, what it does", async () => {
    renderBuilder();

    expect(await screen.findByDisplayValue("Scheduled jobs")).toBeInTheDocument();
    expect(chain()).toEqual([
      "Step 1, Trigger: When a job changes",
      "Step 2, Only if: Its status is Submitted",
      "Step 3, Only if: Its job tag is SCHEDULED",
      "Step 4, Send: Send the assigned tech a text message",
    ]);
    // The rule as one sentence, the same one the card under its name shows.
    expect(
      screen.getByText(
        "When a job has a status of Submitted and its job tag is SCHEDULED, send the assigned tech a text message immediately",
      ),
    ).toBeInTheDocument();
  });

  it("says a condition is checked before anything is sent, wherever its card sits", async () => {
    renderBuilder();
    expect(await screen.findAllByText("checked before anything is sent")).toHaveLength(2);
  });

  it("opens a step's settings when its card is chosen, and says which card is open", async () => {
    const user = userEvent.setup();
    renderBuilder();

    const card = await screen.findByRole("button", { name: /^Step 4, Send/ });
    expect(card).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Step settings")).toHaveTextContent(/Pick a step to set it up/);

    await user.click(card);
    expect(card).toHaveAttribute("aria-expanded", "true");
    expect(card).toHaveAttribute("aria-controls", screen.getByLabelText("Step settings").id);
  });

  it("is a list of steps, with nothing on it that only a pointer can reach", async () => {
    const user = userEvent.setup();
    renderBuilder();
    await screen.findByDisplayValue("Scheduled jobs");

    // One list, one item per step — the shape a screen reader announces as
    // "list, 4 items" before it reads the first one.
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(4);

    // Every step is a real button: it takes focus and Enter opens it, rather
    // than a click handler on a div that only a pointer can reach.
    screen.getByRole("button", { name: /^Step 1, Trigger/ }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: /^Step 1, Trigger/ })).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("button", { name: "Close step settings" }));
    expect(screen.getByRole("button", { name: /^Step 1, Trigger/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Step settings")).toHaveTextContent(/Pick a step/);
  });

  it("shows why a rule the engine cannot run is stuck", async () => {
    renderBuilder({ runnable: false, notRunnableReason: "Workiz sent this to a lead, and there are no leads here" });
    expect(await screen.findByText(/there are no leads here/)).toBeInTheDocument();
  });
});

/**
 * The hard constraint, at the level a person meets it: open a rule, save it,
 * and the rule is the one that was there — every narrowing the chain never
 * showed included.
 */
describe("saving", () => {
  it("stores byte for byte what was opened when nothing was touched", async () => {
    const user = userEvent.setup();
    const narrow: AutomationSpec = {
      version: 1,
      trigger: { kind: "call.completed", callOutcome: "missed", callDirection: "inbound" },
      conditions: [{ any: [{ field: "source", op: "in", values: ["src-gmb"], labels: ["GMB"] }] }],
      actions: [
        { type: "send_sms", to: "client", body: "Sorry we missed you" },
        {
          type: "webhook",
          url: "https://example.test/hook",
          method: "PUT",
          headers: { "X-Auth": "secret" },
          payload: '{"job":"{{job_id}}"}',
        },
      ],
      timing: { delayMinutes: 60, quietHours: "skip", workingHours: { from: "08:00", to: "18:00" } },
    };
    renderBuilder({ spec: narrow });

    await user.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0]).toEqual({ id: "scheduled", body: { name: "Scheduled jobs", spec: narrow } });
  });

  it("saves the step that was deleted, and nothing else", async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(await screen.findByRole("button", { name: "Actions for step 3" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].body.spec?.conditions).toEqual([
      { field: "status", op: "in", values: ["submitted"], labels: ["Submitted"] },
    ]);
    expect(patched[0].body.spec?.actions).toEqual(rule.spec!.actions);
    expect(patched[0].body.spec?.timing).toEqual({ quietHours: "hold", workingHours: { from: "08:00", to: "18:00" } });
  });

  it("duplicates a step into a rule that does the same thing twice", async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(await screen.findByRole("button", { name: "Actions for step 4" }));
    await user.click(await screen.findByRole("menuitem", { name: "Duplicate" }));
    expect(chain()).toHaveLength(5);

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].body.spec?.actions).toEqual([rule.spec!.actions[0], rule.spec!.actions[0]]);
  });

  it("will not save a step the save would refuse, and says which one", async () => {
    const user = userEvent.setup();
    renderBuilder();

    await addStep(user, "Add a step at the end", "Post a webhook");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    // Said beside Save, and on the card that can answer it (§3).
    expect(screen.getByText("Step 5, Post a webhook: A webhook needs a URL")).toBeInTheDocument();
    const card = within(screen.getAllByRole("listitem")[4]);
    expect(card.getByText("A webhook needs a URL")).toBeInTheDocument();
    expect(patched).toHaveLength(0);
  });

  it("will not save a rule with no name", async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.clear(await screen.findByLabelText("Name"));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText("Name is required")).toBeInTheDocument();
  });
});

describe("the + between steps", () => {
  it("is always there, and says where it inserts", async () => {
    renderBuilder();
    await screen.findByDisplayValue("Scheduled jobs");

    expect(screen.getByRole("button", { name: "Add a step after step 1, Trigger" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a step after step 2, Only if" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a step at the end" })).toBeInTheDocument();
  });

  it("offers the steps a rule can take, with what each is for", async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(await screen.findByRole("button", { name: "Add a step at the end" }));
    for (const option of ["Only if …", "Send a message", "Apply a tag", "Change the sub-status", "Post a webhook"]) {
      expect(await screen.findByRole("option", { name: new RegExp(option, "i") })).toBeInTheDocument();
    }
    expect(screen.getByRole("option", { name: /Send a message/i })).toHaveTextContent("a text, an email or both");
  });

  it("narrows the menu by what is typed", async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(await screen.findByRole("button", { name: "Add a step at the end" }));
    await user.keyboard("webh");
    expect(await screen.findByRole("option", { name: /Post a webhook/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Apply a tag/i })).not.toBeInTheDocument();
  });

  it("inserts at the + that was pressed, not at the end", async () => {
    const user = userEvent.setup();
    renderBuilder();

    await screen.findByDisplayValue("Scheduled jobs");
    await addStep(user, "Add a step after step 1, Trigger", "Only if");

    expect(chain()).toEqual([
      "Step 1, Trigger: When a job changes",
      "Step 2, Only if: Choose what to check",
      "Step 3, Only if: Its status is Submitted",
      "Step 4, Only if: Its job tag is SCHEDULED",
      "Step 5, Send: Send the assigned tech a text message",
    ]);
    // The step just added is the one to fill in, so its settings are open.
    expect(screen.getByRole("button", { name: "Step 2, Only if: Choose what to check" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("offers one wait per rule, and says why there is not a second", async () => {
    const user = userEvent.setup();
    renderBuilder();

    await screen.findByDisplayValue("Scheduled jobs");
    await addStep(user, "Add a step after step 1, Trigger", "Wait");
    expect(chain()[1]).toBe("Step 2, Wait: Wait 1 hour before the steps below");

    await user.click(screen.getByRole("button", { name: "Add a step at the end" }));
    const wait = await screen.findByRole("option", { name: /Wait/i });
    expect(wait).toHaveTextContent("one wait per rule");
    expect(wait).toHaveAttribute("aria-disabled", "true");
  });

  it("saves a wait as the delay the engine reads, and drops it when it is deleted", async () => {
    const user = userEvent.setup();
    renderBuilder();

    await screen.findByDisplayValue("Scheduled jobs");
    await addStep(user, "Add a step after step 1, Trigger", "Wait");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].body.spec?.timing).toMatchObject({ delayMinutes: 60 });

    await user.click(screen.getByRole("button", { name: "Actions for step 2" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patched).toHaveLength(2));
    expect(patched[1].body.spec?.timing?.delayMinutes).toBeUndefined();
  });
});

describe("the trigger card", () => {
  it("cannot be deleted or duplicated — a rule is its trigger", async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(await screen.findByRole("button", { name: "Actions for step 1" }));
    expect(await screen.findByRole("menuitem", { name: "Replace" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Duplicate" })).not.toBeInTheDocument();
  });

  it("opens its settings from Replace", async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(await screen.findByRole("button", { name: "Actions for step 1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Replace" }));
    expect(screen.getByRole("button", { name: /^Step 1, Trigger/ })).toHaveAttribute("aria-expanded", "true");
  });
});

describe("the delivery window", () => {
  it("shows the rule's own hours, and drops them for 24/7", async () => {
    const user = userEvent.setup();
    renderBuilder();

    const window = await screen.findByRole("button", { name: /Automation will be sent/ });
    expect(window).toHaveTextContent("8:00 AM – 6:00 PM");

    await user.click(window);
    expect(screen.getByLabelText("From")).toHaveValue("08:00");
    await user.click(screen.getByLabelText("Automation will be sent"));
    await user.click(await screen.findByRole("option", { name: "24/7" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].body.spec?.timing).toBeUndefined();
  });

  it("writes a window on a rule that had none, only when one is asked for", async () => {
    const user = userEvent.setup();
    renderBuilder({ spec: { ...rule.spec!, timing: undefined } });

    const window = await screen.findByRole("button", { name: /Automation will be sent/ });
    expect(window).toHaveTextContent("24/7");

    await user.click(window);
    await user.click(screen.getByLabelText("Automation will be sent"));
    await user.click(await screen.findByRole("option", { name: "Only between set hours" }));
    await user.clear(screen.getByLabelText("To"));
    await user.type(screen.getByLabelText("To"), "20:00");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].body.spec?.timing).toEqual({
      quietHours: "hold",
      workingHours: { from: "09:00", to: "20:00" },
    });
  });

  it('will not put "send anyway" beside a window the engine would then ignore', async () => {
    const user = userEvent.setup();
    renderBuilder({ spec: { ...rule.spec!, timing: { quietHours: "ignore" } } });

    await user.click(await screen.findByRole("button", { name: /Automation will be sent/ }));
    expect(screen.getByLabelText("Outside those hours")).toHaveTextContent("Send anyway");

    await user.click(screen.getByLabelText("Automation will be sent"));
    await user.click(await screen.findByRole("option", { name: "Only between set hours" }));
    // Asking for a window means asking for it to be kept — `placement` answers
    // "now" on `ignore` before it ever reads `workingHours`.
    expect(screen.getByLabelText("Outside those hours")).toHaveTextContent("Hold until the window opens");
  });

  it("saves what happens outside the window", async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(await screen.findByRole("button", { name: /Automation will be sent/ }));
    await user.click(screen.getByLabelText("Outside those hours"));
    await user.click(await screen.findByRole("option", { name: "Skip the message" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].body.spec?.timing).toMatchObject({ quietHours: "skip" });
  });
});

describe("what the builder keeps reachable", () => {
  it("tests the rule against a job and shows what it would send", async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(await screen.findByRole("button", { name: "Test against a job" }));
    await user.type(await screen.findByLabelText("Job id"), "d1");
    await user.click(screen.getByRole("button", { name: "Run test" }));

    const result = await screen.findByTestId("automation-test-result");
    expect(result).toHaveTextContent("New scheduled job K4T9ZW");
    expect(result).toHaveTextContent("Would send");
    expect(tested).toEqual([{ dealId: "d1" }]);
  });

  it("opens the firing log from the menu at the top", async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(await screen.findByRole("button", { name: "Rule actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Firing log" }));
    expect(await screen.findByText(/The last firings of this rule/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /every firing of this rule/i })).toBeInTheDocument();
  });

  it("goes back to the list without saving", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const closed: boolean[] = [];
    render(
      <QueryClientProvider client={client}>
        <AutomationBuilderDialog rule={rule} open onOpenChange={(o) => closed.push(o)} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "Back to automations" }));
    expect(closed).toEqual([false]);
    expect(patched).toEqual([]);
  });
});

/** The seam the recipe library plugs into: no rule, a draft to start from. */
describe("creating", () => {
  const draft: AutomationDraft = {
    name: "Missed call / text the client",
    category: "phone",
    spec: {
      version: 1,
      // `callDirection` and the working-hours window have no card of their own:
      // a recipe that carries them must not be widened by a save.
      trigger: { kind: "call.completed", callOutcome: "missed", callDirection: "inbound" },
      conditions: [],
      actions: [{ type: "send_sms", to: "client", body: "Sorry we missed you" }],
      timing: { quietHours: "hold", workingHours: { from: "08:00", to: "18:00" } },
    },
  };

  it("opens on the recipe's own name and chain", async () => {
    renderCreate(draft);

    expect(await screen.findByDisplayValue("Missed call / text the client")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create automation" })).toBeInTheDocument();
    expect(chain()).toEqual([
      "Step 1, Trigger: When a call is missed",
      "Step 2, Send: Send the client a text message",
    ]);
    // Nothing exists to dry-run yet.
    expect(screen.queryByRole("button", { name: /test against a job/i })).not.toBeInTheDocument();
  });

  it("posts the recipe as a new rule — off, in its section, narrowings intact", async () => {
    const user = userEvent.setup();
    const closed: boolean[] = [];
    renderCreate(draft, (open) => closed.push(open));

    await screen.findByDisplayValue("Missed call / text the client");
    await user.click(screen.getByRole("button", { name: "Create automation" }));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toEqual({
      name: "Missed call / text the client",
      enabled: false,
      category: "phone",
      spec: draft.spec,
    });
    expect(closed).toEqual([false]);
  });

  it("starts a blank rule on a trigger and a message, and waits for both to be filled in", async () => {
    renderCreate();

    expect(await screen.findByLabelText("Name")).toHaveValue("");
    expect(chain()).toEqual([
      "Step 1, Trigger: When a job's status changes",
      "Step 2, Send: Send the client a text message",
    ]);
    expect(screen.getByRole("button", { name: "Create automation" })).toBeDisabled();
    expect(screen.getByText("Name is required")).toBeInTheDocument();
    expect(created).toEqual([]);
  });
});
