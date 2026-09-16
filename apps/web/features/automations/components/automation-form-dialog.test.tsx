import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { AutomationRule, AutomationSpec } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { AutomationFormDialog, type AutomationDraft } from "./automation-form-dialog";

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
const tested: Array<unknown> = [];

const SUB_STATUSES = [
  { id: "sub-done", name: "Paid in full", group: "done", color: "green", priority: 1, active: true },
  { id: "sub-cancel", name: "Canceled check", group: "canceled", color: "red", priority: 1, active: true },
];

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
    http.get("*/deals/job-tags", () =>
      HttpResponse.json({
        success: true,
        data: [{ id: TAG_ID, name: "SCHEDULED", color: "blue", priority: 1, active: true }],
      }),
    ),
    http.get("*/deals/job-types", () => HttpResponse.json({ success: true, data: [] })),
    http.get("*/deals/job-sources", () =>
      HttpResponse.json({
        success: true,
        data: [
          { id: "src-gmb", name: "GMB", active: true },
          { id: "src-yelp", name: "Yelp", active: true },
          { id: "src-fb", name: "Facebook", active: true },
        ],
      }),
    ),
    http.get("*/deals/job-statuses", () => HttpResponse.json({ success: true, data: SUB_STATUSES })),
    http.get("*/messaging/templates/short-codes", () =>
      HttpResponse.json({
        success: true,
        data: [{ code: "job_date", group: "job", description: "The job's date", example: "Sep 20" }],
      }),
    ),
    http.get("*/users", () =>
      HttpResponse.json({
        success: true,
        data: [
          { id: "u1", firstName: "Ann", lastName: "Lee", email: "ann@example.test", status: "active" },
          { id: "u2", firstName: "Bo", lastName: "Diaz", email: "bo@example.test", status: "active" },
        ],
        pagination: { count: 2 },
      }),
    ),
    http.get("*/users/roles", () =>
      HttpResponse.json({ success: true, data: [{ id: "r1", name: "Dispatch", permissions: {}, dataScope: {} }] }),
    ),
  );
});

function renderDialog(over: Partial<AutomationRule> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AutomationFormDialog rule={{ ...rule, ...over }} open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

/** The other half of the contract: no rule, a recipe's draft or nothing. */
function renderCreate(draft?: AutomationDraft, onOpenChange: (open: boolean) => void = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AutomationFormDialog draft={draft} open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
}

const messageBox = () => screen.getByRole("textbox", { name: "Message" });

/** Pick `option` out of the select or chip picker named `name`. */
async function pick(user: ReturnType<typeof userEvent.setup>, name: string, option: string) {
  await user.click(screen.getByLabelText(name));
  await user.click(await screen.findByRole("option", { name: option }));
}

const spec = () => patched[0]?.body.spec ?? created[0]?.spec;

describe("AutomationFormDialog", () => {
  it("opens on the rule's own trigger, conditions and message", async () => {
    renderDialog();

    expect(await screen.findByDisplayValue("Scheduled jobs")).toBeInTheDocument();
    expect(screen.getByLabelText("Trigger")).toHaveTextContent("Job matches");
    expect(screen.getByLabelText("Condition 1 field")).toHaveTextContent("Job status");
    expect(screen.getByLabelText("Condition 2 field")).toHaveTextContent("Job tag");
    expect(screen.getByLabelText("Action 1 recipient")).toHaveTextContent("Assigned technicians");
    expect(messageBox().textContent).toBe("New scheduled job {{job_id}}");
  });

  it("previews the rule as a sentence and keeps it in step with the form", async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(
      await screen.findByText(
        "When a job has a status of Submitted and its job tag is SCHEDULED, send the assigned tech a text message immediately",
      ),
    ).toBeInTheDocument();

    await pick(user, "Delay", "After 1 day");
    expect(
      await screen.findByText(
        "When a job has a status of Submitted and its job tag is SCHEDULED, send the assigned tech a text message after 1 day",
      ),
    ).toBeInTheDocument();
  });

  it("saves the edited spec and keeps the imported working-hours window", async () => {
    const user = userEvent.setup();
    renderDialog();

    const body = await screen.findByRole("textbox", { name: "Message" });
    await user.clear(body);
    await user.type(body, "Job moved");
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].id).toBe("scheduled");
    expect(patched[0].body.spec?.actions).toEqual([{ type: "send_sms", to: "assigned_techs", body: "Job moved" }]);
    expect(patched[0].body.spec?.conditions).toHaveLength(2);
    expect(patched[0].body.spec?.timing).toEqual({ quietHours: "hold", workingHours: { from: "08:00", to: "18:00" } });
  });

  it("refuses to save a message that is empty", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.clear(await screen.findByRole("textbox", { name: "Message" }));
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    expect(await screen.findByText("Write a message or pick a template")).toBeInTheDocument();
    expect(patched).toHaveLength(0);
  });

  it("removes a condition", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Remove condition 2" }));
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].body.spec?.conditions).toEqual([
      { field: "status", op: "in", values: ["submitted"], labels: ["Submitted"] },
    ]);
  });

  it("tests the rule against a job and shows what it would send", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Test against a job" }));
    await user.type(await screen.findByLabelText("Job id"), "d1");
    await user.click(screen.getByRole("button", { name: "Run test" }));

    const result = await screen.findByTestId("automation-test-result");
    expect(result).toHaveTextContent("New scheduled job K4T9ZW");
    expect(result).toHaveTextContent("Would send");
    expect(tested).toEqual([{ dealId: "d1" }]);
  });
});

/** The seam the recipe library plugs into: no rule, a draft to start from. */
describe("AutomationFormDialog, creating", () => {
  const draft: AutomationDraft = {
    name: "Missed call / text the client",
    category: "phone",
    spec: {
      version: 1,
      // `callDirection` and the working-hours window have no field in the
      // editor: a recipe that carries them must not be widened by a save.
      trigger: { kind: "call.completed", callOutcome: "missed", callDirection: "inbound" },
      conditions: [],
      actions: [{ type: "send_sms", to: "client", body: "Sorry we missed you" }],
      timing: { quietHours: "hold", workingHours: { from: "08:00", to: "18:00" } },
    },
  };

  it("opens on the recipe's own name, trigger and message", async () => {
    renderCreate(draft);

    expect(await screen.findByDisplayValue("Missed call / text the client")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create automation" })).toBeInTheDocument();
    expect(screen.getByLabelText("Trigger")).toHaveTextContent("Call ends");
    expect(messageBox().textContent).toBe("Sorry we missed you");
    // Nothing exists to dry-run yet.
    expect(screen.queryByRole("button", { name: "Test against a job" })).not.toBeInTheDocument();
  });

  it("posts the recipe as a new rule — off, in its section, narrowings intact", async () => {
    const user = userEvent.setup();
    const closed: boolean[] = [];
    renderCreate(draft, (open) => closed.push(open));

    await screen.findByDisplayValue("Missed call / text the client");
    await user.click(screen.getByRole("button", { name: "Create automation" }));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({
      name: "Missed call / text the client",
      enabled: false,
      category: "phone",
    });
    expect(created[0].spec?.trigger).toEqual({
      kind: "call.completed",
      callOutcome: "missed",
      callDirection: "inbound",
    });
    expect(created[0].spec?.timing).toEqual({
      quietHours: "hold",
      workingHours: { from: "08:00", to: "18:00" },
    });
    expect(patched).toEqual([]);
    expect(closed).toEqual([false]);
  });

  it("starts empty when no recipe supplied one, and refuses a rule with nothing to send", async () => {
    const user = userEvent.setup();
    renderCreate();

    expect(await screen.findByLabelText("Name")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Create automation" }));

    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(created).toEqual([]);
  });
});

describe("the delivery window", () => {
  it("shows the rule's own hours, and drops them for 24/7", async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(await screen.findByLabelText("Automation will be sent")).toHaveTextContent("Only between set hours");
    expect(screen.getByLabelText("From")).toHaveValue("08:00");
    expect(screen.getByLabelText("To")).toHaveValue("18:00");

    await pick(user, "Automation will be sent", "24/7");
    expect(screen.queryByLabelText("From")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].body.spec?.timing).toBeUndefined();
  });

  it("opens on 24/7 for a rule with no window, and writes one only when asked", async () => {
    const user = userEvent.setup();
    renderDialog({ spec: { ...rule.spec!, timing: undefined } });

    expect(await screen.findByLabelText("Automation will be sent")).toHaveTextContent("24/7");
    await pick(user, "Automation will be sent", "Only between set hours");
    await user.clear(screen.getByLabelText("To"));
    await user.type(screen.getByLabelText("To"), "20:00");
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].body.spec?.timing).toEqual({
      quietHours: "hold",
      workingHours: { from: "09:00", to: "20:00" },
    });
  });

  it('will not put "send anyway" beside a window the engine would then ignore', async () => {
    const user = userEvent.setup();
    // A rule Workiz exported with DND off: no window, sends at any hour.
    renderDialog({ spec: { ...rule.spec!, timing: { quietHours: "ignore" } } });

    expect(await screen.findByLabelText("Outside those hours")).toHaveTextContent("Send anyway");
    await pick(user, "Automation will be sent", "Only between set hours");

    // Asking for a window means asking for it to be kept — "send anyway"
    // short-circuits `placement` before it ever reads `workingHours`.
    expect(screen.getByLabelText("Outside those hours")).toHaveTextContent("Hold until the window opens");
    await user.click(screen.getByLabelText("Outside those hours"));
    expect(await screen.findByRole("option", { name: /Send anyway — not with a window/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("says what happens outside the window, holding by default as Workiz does", async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(await screen.findByLabelText("Outside those hours")).toHaveTextContent("Hold until the window opens");
    await pick(user, "Outside those hours", "Skip the message");
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].body.spec?.timing).toMatchObject({ quietHours: "skip" });
  });
});

describe("the timing anchor", () => {
  const reminder: AutomationSpec = {
    version: 1,
    trigger: { kind: "schedule.relative", anchor: "scheduledStart", offsetMinutes: -60 },
    conditions: [],
    actions: [{ type: "send_sms", to: "client", body: "See you soon" }],
  };

  it("reads a stored offset as a sentence of four parts", async () => {
    renderDialog({ spec: reminder });

    expect(await screen.findByLabelText("Send")).toHaveValue(1);
    expect(screen.getByLabelText("Offset unit")).toHaveTextContent("hours");
    expect(screen.getByLabelText("Before or after")).toHaveTextContent("ahead of");
    expect(screen.getByLabelText("Counted from")).toHaveTextContent("the job's start");
    expect(
      screen.getByText("When it is 1 hour before the job's start, send the client a text message immediately"),
    ).toBeInTheDocument();
  });

  it("writes the minutes the engine reads", async () => {
    const user = userEvent.setup();
    renderDialog({ spec: reminder });

    await user.clear(await screen.findByLabelText("Send"));
    await user.type(screen.getByLabelText("Send"), "3");
    await pick(user, "Offset unit", "days");
    await pick(user, "Before or after", "after");
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].body.spec?.trigger).toEqual({
      kind: "schedule.relative",
      anchor: "scheduledStart",
      offsetMinutes: 4320,
    });
  });

  it("never offers an offset ahead of a date that has already passed", async () => {
    const user = userEvent.setup();
    renderDialog({ spec: reminder });

    await pick(user, "Counted from", "when it was created");
    // The direction had to move with the anchor: nothing can be sent ahead of
    // a job's creation, and the scheduler would simply never arm it.
    expect(screen.getByLabelText("Before or after")).toHaveTextContent("after");
    await user.click(screen.getByLabelText("Before or after"));
    expect(await screen.findByRole("option", { name: "ahead of" })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("the status trigger", () => {
  const onTwo: AutomationSpec = {
    version: 1,
    trigger: { kind: "deal.status_changed", to: ["done", "canceled"] },
    conditions: [],
    actions: [{ type: "send_sms", to: "client", body: "All done" }],
  };
  const onOne: AutomationSpec = { ...onTwo, trigger: { kind: "deal.status_changed", to: ["done"] } };

  it("shows every status the rule fires on, and says so in the sentence", async () => {
    renderDialog({ spec: onTwo });

    const picker = await screen.findByLabelText("Status entered");
    expect(picker).toHaveTextContent("Done");
    expect(picker).toHaveTextContent("Canceled");
    expect(
      screen.getByText(
        "When a job has a status of Done or Canceled, send the client a text message immediately",
      ),
    ).toBeInTheDocument();
  });

  it("adds a second status to the one already picked instead of replacing it", async () => {
    const user = userEvent.setup();
    renderDialog({ spec: onOne });

    await user.click(await screen.findByLabelText("Status entered"));
    await user.click(await screen.findByRole("option", { name: "Canceled" }));
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].body.spec?.trigger).toEqual({
      kind: "deal.status_changed",
      to: ["done", "canceled"],
    });
  });

  it("keeps a sub-status that still fits, and drops one that cannot be entered any more", async () => {
    const user = userEvent.setup();
    renderDialog({
      spec: { ...onOne, trigger: { kind: "deal.status_changed", to: ["done"], toSubStatus: ["sub-done"] } },
    });

    // "Paid in full" is filed under Done, so widening the trigger to Canceled
    // as well leaves it reachable.
    await user.click(await screen.findByLabelText("Status entered"));
    await user.click(await screen.findByRole("option", { name: "Canceled" }));
    expect(screen.getByLabelText("Sub-status entered")).toHaveTextContent("Paid in full");

    // Dropping Done leaves a sub-status this trigger can never enter.
    await user.click(screen.getByRole("option", { name: "Done" }));
    expect(screen.getByLabelText("Sub-status entered")).toHaveTextContent("Any sub-status");

    await user.click(screen.getByRole("button", { name: "Save rule" }));
    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].body.spec?.trigger).toEqual({ kind: "deal.status_changed", to: ["canceled"] });
  });
});

describe("the sub-status picker", () => {
  const statusRule: AutomationSpec = {
    version: 1,
    trigger: { kind: "deal.status_changed", to: ["done"] },
    conditions: [],
    actions: [{ type: "send_sms", to: "client", body: "All done" }],
  };

  it("offers the sub-statuses of the chosen status and stores the ids", async () => {
    const user = userEvent.setup();
    renderDialog({ spec: statusRule });

    await user.click(await screen.findByLabelText("Sub-status entered"));
    // Only the sub-statuses filed under Done — a sub-status of another
    // super-status can never be entered by this trigger.
    expect(await screen.findByRole("option", { name: "Paid in full" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Canceled check" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: "Paid in full" }));
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].body.spec?.trigger).toEqual({
      kind: "deal.status_changed",
      to: ["done"],
      toSubStatus: ["sub-done"],
    });
  });
});

describe("email actions", () => {
  it("asks for a subject only when there is a subject line to fill", async () => {
    const user = userEvent.setup();
    renderDialog();

    await screen.findByLabelText("Action 1 type");
    expect(screen.queryByLabelText("Subject")).not.toBeInTheDocument();

    await pick(user, "Action 1 type", "Send email");
    await user.type(screen.getByLabelText("Subject"), "Your job is booked");
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].body.spec?.actions).toEqual([
      {
        type: "send_email",
        to: "assigned_techs",
        body: "New scheduled job {{job_id}}",
        subject: "Your job is booked",
      },
    ]);
  });

  it("saves one \"text and email\" choice as two actions, and reads them back as one", async () => {
    const user = userEvent.setup();
    renderDialog();

    await pick(user, "Action 1 type", "Send text and email");
    await user.type(await screen.findByLabelText("Subject"), "Job update");
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].body.spec?.actions).toEqual([
      { type: "send_sms", to: "assigned_techs", body: "New scheduled job {{job_id}}" },
      { type: "send_email", to: "assigned_techs", body: "New scheduled job {{job_id}}", subject: "Job update" },
    ]);
  });

  it("re-opens that pair as one row, not two to keep in step by hand", async () => {
    renderDialog({
      spec: {
        ...rule.spec!,
        actions: [
          { type: "send_sms", to: "assigned_techs", body: "New scheduled job" },
          { type: "send_email", to: "assigned_techs", body: "New scheduled job", subject: "Job update" },
        ],
      },
    });

    const types = await screen.findAllByLabelText(/^Action \d+ type$/);
    expect(types).toHaveLength(1);
    expect(types[0]).toHaveTextContent("Send text and email");
    expect(screen.getByLabelText("Subject")).toHaveValue("Job update");
  });
});

describe("recipients", () => {
  it("names the people a rule notifies, instead of sending to nobody", async () => {
    const user = userEvent.setup();
    renderDialog();

    await pick(user, "Action 1 recipient", "Selected users");
    await user.click(await screen.findByLabelText("Action 1 people"));
    await user.click(await screen.findByRole("option", { name: "Ann Lee" }));
    await user.click(screen.getByRole("option", { name: "Bo Diaz" }));
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].body.spec?.actions?.[0]).toMatchObject({ to: "users", userIds: ["u1", "u2"] });
  });

  it("refuses to save a rule that notifies a role nobody chose", async () => {
    const user = userEvent.setup();
    renderDialog();

    await pick(user, "Action 1 recipient", "A role");
    await user.click(screen.getByRole("button", { name: "Save rule" }));
    expect(await screen.findByText(/at least one role/i)).toBeInTheDocument();
    expect(patched).toHaveLength(0);

    await user.click(screen.getByLabelText("Action 1 roles"));
    await user.click(await screen.findByRole("option", { name: "Dispatch" }));
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].body.spec?.actions?.[0]).toMatchObject({ to: "role", roleIds: ["r1"] });
  });

  it("does not offer the job's own people to a rule with no job", async () => {
    const user = userEvent.setup();
    renderDialog({
      spec: {
        version: 1,
        trigger: { kind: "call.completed", callOutcome: "missed" },
        conditions: [],
        actions: [{ type: "send_sms", to: "dispatcher", body: "Missed one" }],
      },
    });

    // The rule already sends to nobody — say so rather than leave it silent.
    expect(await screen.findByText(/would reach nobody/i)).toBeInTheDocument();
    await user.click(screen.getByLabelText("Action 1 recipient"));
    expect(await screen.findByRole("option", { name: /Dispatcher — needs a job/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});

describe("conditions", () => {
  it("puts several values in one condition, where there used to be one rule each", async () => {
    const user = userEvent.setup();
    renderDialog({
      spec: {
        ...rule.spec!,
        conditions: [{ field: "source", op: "in", values: ["src-gmb"], labels: ["GMB"] }],
      },
    });

    await user.click(await screen.findByLabelText("Condition 1 value"));
    await user.click(await screen.findByRole("option", { name: "Yelp" }));
    await user.click(screen.getByRole("option", { name: "Facebook" }));
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].body.spec?.conditions).toEqual([
      { field: "source", op: "in", values: ["src-gmb", "src-yelp", "src-fb"], labels: ["GMB", "Yelp", "Facebook"] },
    ]);
  });

  it("lets the keyboard drop a value the catalog cannot name", async () => {
    const user = userEvent.setup();
    renderDialog({
      spec: {
        ...rule.spec!,
        // What the import leaves behind: an ad-group id no catalog here holds.
        conditions: [{ field: "source", op: "in", values: ["src-gmb", "adgroup:9912"], labels: ["GMB"] }],
      },
    });

    const picker = await screen.findByLabelText("Condition 1 value");
    expect(picker).toHaveTextContent("adgroup:9912");

    // The chip's × is a pointer shortcut, so the list is the whole keyboard
    // path — and it has to offer the values the catalog cannot account for.
    await user.click(picker);
    await user.keyboard("adgroup");
    expect(
      await screen.findByRole("option", { name: /adgroup:9912\s*no longer in the catalog/ }),
    ).toBeInTheDocument();
    await user.keyboard("{Enter}");

    expect(screen.getByLabelText("Condition 1 value")).not.toHaveTextContent("adgroup:9912");
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].body.spec?.conditions).toEqual([
      { field: "source", op: "in", values: ["src-gmb"], labels: ["GMB"] },
    ]);
  });

  it("shows an imported \"any of\" group instead of hiding it", async () => {
    renderDialog({
      spec: {
        ...rule.spec!,
        conditions: [
          {
            any: [
              { field: "source", op: "in", values: ["src-gmb"], labels: ["GMB"] },
              { field: "source", op: "in", values: ["src-yelp"], labels: ["Yelp"] },
            ],
          },
        ],
      },
    });

    expect(await screen.findByText("Any one of these")).toBeInTheDocument();
    expect(screen.getByLabelText("Condition 1 option 1 value")).toHaveTextContent("GMB");
    expect(screen.getByLabelText("Condition 1 option 2 value")).toHaveTextContent("Yelp");
    expect(
      screen.getByText(/its source is one of GMB or Yelp/),
    ).toBeInTheDocument();
  });

  it("adds an alternative to a plain condition, and drops the group with its last one", async () => {
    const user = userEvent.setup();
    renderDialog({
      spec: { ...rule.spec!, conditions: [{ field: "source", op: "in", values: ["src-gmb"], labels: ["GMB"] }] },
    });

    await user.click(await screen.findByRole("button", { name: "Add an alternative to condition 1" }));
    await user.click(screen.getByLabelText("Condition 1 option 2 field"));
    await user.click(await screen.findByRole("option", { name: "Source" }));
    await user.click(screen.getByLabelText("Condition 1 option 2 value"));
    await user.click(await screen.findByRole("option", { name: "Yelp" }));
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].body.spec?.conditions).toEqual([
      {
        any: [
          { field: "source", op: "in", values: ["src-gmb"], labels: ["GMB"] },
          { field: "source", op: "in", values: ["src-yelp"], labels: ["Yelp"] },
        ],
      },
    ]);

    // Emptying the group takes the group with it, rather than leaving an
    // "any of nothing" the rule can never satisfy.
    await user.click(screen.getByRole("button", { name: "Remove condition 1 option 2" }));
    await user.click(screen.getByRole("button", { name: "Remove condition 1 option 1" }));
    expect(screen.queryByText("Any one of these")).not.toBeInTheDocument();
    expect(screen.getByText(/No conditions/)).toBeInTheDocument();
  });

  it("says so when a condition is emptied, instead of dropping it in silence", async () => {
    const user = userEvent.setup();
    renderDialog({
      spec: { ...rule.spec!, conditions: [{ field: "source", op: "in", values: ["src-gmb"], labels: ["GMB"] }] },
    });

    expect(await screen.findByLabelText("Condition 1 value")).toHaveTextContent("GMB");
    expect(screen.queryByText(/narrows nothing/i)).not.toBeInTheDocument();

    // Unticking the last source widens the rule from one source to every
    // source — the engine reads an empty `in` as no narrowing at all.
    await user.click(screen.getByLabelText("Condition 1 value"));
    await user.click(await screen.findByRole("option", { name: "GMB" }));
    expect(await screen.findByText(/narrows nothing/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save rule" }));
    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].body.spec?.conditions).toEqual([]);
  });

  it("adds an empty or-group from the header and saves what was filled in", async () => {
    const user = userEvent.setup();
    renderDialog({ spec: { ...rule.spec!, conditions: [] } });

    await user.click(await screen.findByRole("button", { name: /Or group/ }));
    const group = screen.getByText("Any one of these").parentElement!;
    expect(within(group).getAllByLabelText(/Condition 1 option \d field/)).toHaveLength(2);

    await user.click(screen.getByLabelText("Condition 1 option 1 value"));
    await user.click(await screen.findByRole("option", { name: "SCHEDULED" }));
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(patched).toHaveLength(1));
    // The alternative nobody filled in narrows nothing and is not stored.
    expect(patched[0].body.spec?.conditions).toEqual([
      { any: [{ field: "tag", op: "in", values: [TAG_ID], labels: ["SCHEDULED"] }] },
    ]);
  });
});

describe("the message body", () => {
  it("draws every short code as one chip", async () => {
    renderDialog();

    const body = await screen.findByRole("textbox", { name: "Message" });
    const chips = body.querySelectorAll("[data-short-code]");
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent("{{job_id}}");
    expect(chips[0]).toHaveAttribute("contenteditable", "false");
  });

  it("inserts a short code from the menu and saves it as text the renderer takes", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Insert a short code" }));
    await user.click(await screen.findByRole("menuitem", { name: /job_date/ }));

    const body = screen.getByRole("textbox", { name: "Message" });
    expect(body.querySelectorAll("[data-short-code]")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(spec()?.actions?.[0].body).toBe("New scheduled job {{job_id}}{{job_date}}");
  });
});
