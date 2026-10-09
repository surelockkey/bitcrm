import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse, delay } from "msw";
import { server } from "@/test/msw/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AutomationsPage } from "./automations-page";

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true, me: { id: "me" }, isLoading: false, isTechnician: false }),
}));

const TAG_ID = "tag-1";

const rules = [
  {
    id: "canceled",
    name: "Canceled job & techs",
    enabled: true,
    firedCount: 12,
    workizTriggered: 5411,
    runnable: true,
    specSource: "workiz-translator",
    spec: {
      version: 1,
      trigger: { kind: "deal.status_changed", to: ["canceled"] },
      conditions: [{ field: "hasTechs", op: "exists" }],
      actions: [{ type: "send_sms", to: "assigned_techs", body: "CLIENT CANCELED" }],
    },
    createdAt: "2026-09-15T10:00:00.000Z",
    updatedAt: "2026-09-15T10:00:00.000Z",
  },
  {
    id: "scheduled",
    name: "Scheduled jobs",
    enabled: false,
    runnable: true,
    spec: {
      version: 1,
      trigger: { kind: "deal.updated" },
      conditions: [{ field: "tag", op: "in", values: [TAG_ID] }],
      actions: [{ type: "send_sms", to: "assigned_techs", body: "New scheduled job" }],
    },
    createdAt: "2026-09-15T10:00:00.000Z",
    updatedAt: "2026-09-15T10:00:00.000Z",
  },
  {
    id: "invoice",
    name: "Invoice due 7 days",
    enabled: false,
    runnable: false,
    category: "followUps",
    notRunnableReason: "Workiz invoice rules have no BitCRM equivalent",
    workizTriggered: 5,
    createdAt: "2026-09-15T10:00:00.000Z",
    updatedAt: "2026-09-15T10:00:00.000Z",
  },
];

const patched: Array<{ id: string; body: unknown }> = [];
const created: unknown[] = [];
const duplicated: Array<{ id: string; body: unknown }> = [];
const deleted: string[] = [];

beforeEach(() => {
  patched.length = 0;
  created.length = 0;
  duplicated.length = 0;
  deleted.length = 0;
  server.use(
    http.get("*/messaging/automations", () => HttpResponse.json({ success: true, data: rules })),
    http.get("*/messaging/automations/:id/runs", () =>
      HttpResponse.json({
        success: true,
        data: [
          {
            id: "run-1",
            ruleId: "canceled",
            firedAt: "2026-09-16T15:04:00.000Z",
            trigger: "deal.status_changed",
            entity: "deal:d1",
            occurrence: "o",
            outcome: "sent",
            actions: [{ type: "send_sms", to: "tech Ann", outcome: "sent" }],
          },
        ],
      }),
    ),
    http.post("*/messaging/automations", async ({ request }) => {
      created.push(await request.json());
      return HttpResponse.json({ success: true, data: { ...rules[0], id: "new-1", name: "Late tech" } });
    }),
    http.post("*/messaging/automations/:id/duplicate", async ({ params, request }) => {
      duplicated.push({ id: String(params.id), body: await request.json() });
      return HttpResponse.json({ success: true, data: { ...rules[0], id: "copy", name: "Copy" } });
    }),
    http.delete("*/messaging/automations/:id", ({ params }) => {
      deleted.push(String(params.id));
      return HttpResponse.json({ success: true, data: { id: String(params.id) } });
    }),
    http.patch("*/messaging/automations/:id", async ({ params, request }) => {
      patched.push({ id: String(params.id), body: await request.json() });
      const rule = rules.find((r) => r.id === String(params.id));
      return HttpResponse.json({ success: true, data: { ...rule, enabled: true } });
    }),
    http.post("*/messaging/automations/migrate", () =>
      HttpResponse.json({
        success: true,
        data: { rules: 3, runnable: 2, written: 2, coverage: [] },
      }),
    ),
    http.get("*/deals/job-tags", () =>
      HttpResponse.json({ success: true, data: [{ id: TAG_ID, name: "SCHEDULED", color: "blue", priority: 1, active: true }] }),
    ),
    http.get("*/deals/job-types", () => HttpResponse.json({ success: true, data: [] })),
    http.get("*/deals/job-sources", () => HttpResponse.json({ success: true, data: [] })),
    http.get("*/deals/job-statuses", () => HttpResponse.json({ success: true, data: [] })),
  );
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <AutomationsPage />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

/** A rule's sentence, drawn in parts (its slots underlined), found by its whole text. */
const sentence = (text: string | RegExp) =>
  screen.findByText((_, el) =>
    el?.tagName === "P" && (typeof text === "string" ? el.textContent === text : text.test(el.textContent ?? "")),
  );

/** The names on the cards, in the order the list shows them. */
function listed() {
  return screen
    .getAllByTestId(/^automation-/)
    .map((card) => within(card).getByRole("switch").getAttribute("aria-label")?.replace(/^(Enable|Disable) /, ""));
}

describe("AutomationsPage", () => {
  it("lists the rules with the Workiz sentence and the firing counts", async () => {
    renderPage();

    expect(await screen.findByText("Canceled job & techs")).toBeInTheDocument();
    // The status reads as the editor writes it — "Canceled", not the
    // `canceled` the trigger stores — on the card as well as in the editor.
    expect(
      await sentence(
        "When a job has a status of Canceled and it has a technician, send the assigned tech a text message immediately",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Firing log of Canceled job & techs" })).toHaveTextContent(
      "Triggered 12 times",
    );
    expect(screen.getByText("5411 in Workiz")).toBeInTheDocument();
    // Workiz's left column: the rows count the rules, and the total says how often they fired.
    expect(screen.getByRole("button", { name: "All 3" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Active 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inactive 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cannot run 1" })).toBeInTheDocument();
    expect(screen.getByText("Automations triggered").nextElementSibling).toHaveTextContent("12");
  });

  it("names the job tag from the catalog instead of its id", async () => {
    renderPage();
    expect(await sentence(/its job tag is SCHEDULED/)).toBeInTheDocument();
  });

  it("switches a rule on", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("switch", { name: "Enable Scheduled jobs" }));
    await waitFor(() => expect(patched).toEqual([{ id: "scheduled", body: { enabled: true } }]));
  });

  it("cannot switch on a rule the engine cannot run, and says why", async () => {
    renderPage();
    const card = await screen.findByTestId("automation-invoice");
    expect(within(card).getByRole("switch")).toBeDisabled();
    expect(within(card).getByText("Cannot run here")).toBeInTheDocument();
  });

  it("re-checks the imported rules from the page", async () => {
    const user = userEvent.setup();
    let migrated = 0;
    server.use(
      http.post("*/messaging/automations/migrate", () => {
        migrated += 1;
        return HttpResponse.json({
          success: true,
          data: { rules: 3, runnable: 2, written: 2, coverage: [] },
        });
      }),
    );
    renderPage();

    await user.click(await screen.findByRole("button", { name: /re-check imports/i }));
    await waitFor(() => expect(migrated).toBe(1));
  });

  it("offers the account-wide firing feed", async () => {
    renderPage();

    expect(await screen.findByRole("link", { name: /activity/i })).toHaveAttribute(
      "href",
      "/automations/activity",
    );
  });

  it("shows the firing log for a rule", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Firing log of Canceled job & techs" }));
    const runs = await screen.findByTestId("automation-runs");
    // The log names what it did, not the key it is filed under (§4.6 item 1).
    expect(within(runs).getByRole("link", { name: "Open job d1" })).toHaveAttribute(
      "href",
      "/deals/d1",
    );
    expect(within(runs).getByText(/1 sent/)).toBeInTheDocument();
    expect(within(runs).getByText(/to tech Ann/)).toBeInTheDocument();
    // The outcome of the firing itself, and of the one action it took.
    expect(within(runs).getAllByText("Sent")).toHaveLength(2);
  });
});

describe("AutomationsPage tabs", () => {
  it("opens on the rules the workspace already has, and counts them in the left column", async () => {
    renderPage();

    expect(await screen.findByRole("tab", { name: "My Automations" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Discover" })).toHaveAttribute("aria-selected", "false");
    expect(await screen.findByRole("button", { name: "All 3" })).toBeInTheDocument();
  });

  it("opens on the library when there is nothing to list yet", async () => {
    server.use(
      http.get("*/messaging/automations", async () => {
        await delay(20);
        return HttpResponse.json({ success: true, data: [] });
      }),
    );
    renderPage();

    // Not while it loads: an empty workspace is a fact about the answer.
    expect(screen.getByRole("tab", { name: "My Automations" })).toHaveAttribute("aria-selected", "true");

    expect(await screen.findByRole("tab", { name: "Discover", selected: true })).toBeInTheDocument();
    expect(screen.getByTestId("automation-library")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "My Automations" })).toHaveAttribute("aria-selected", "false");
  });

  it("waits on the rules with their skeleton, not with the library", async () => {
    server.use(
      http.get("*/messaging/automations", async () => {
        await delay(20);
        return HttpResponse.json({ success: true, data: rules });
      }),
    );
    renderPage();

    expect(screen.getByRole("tab", { name: "My Automations" })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(screen.queryByTestId("automation-library")).not.toBeInTheDocument();

    expect(await screen.findByText("Canceled job & techs")).toBeInTheDocument();
  });

  it("lets the reader cross to the library and back", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "Discover" }));
    expect(await screen.findByTestId("automation-library")).toBeInTheDocument();
    expect(screen.getByLabelText("Search automations")).toHaveAttribute("placeholder", "Search the template");

    await user.click(screen.getByRole("tab", { name: "My Automations" }));
    expect(await screen.findByText("Canceled job & techs")).toBeInTheDocument();
  });
});

describe("AutomationsPage filters", () => {
  it("searches the name and the sentence", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Canceled job & techs");

    await user.type(screen.getByLabelText("Search automations"), "scheduled");
    // "SCHEDULED" is the job tag inside the second rule's sentence.
    await waitFor(() => expect(listed()).toEqual(["Scheduled jobs"]));
  });

  it("narrows to one state with the left column's rows, one row at a time", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Canceled job & techs");

    await user.click(screen.getByRole("button", { name: "Cannot run 1" }));
    await waitFor(() => expect(listed()).toEqual(["Invoice due 7 days"]));
    expect(screen.getByRole("button", { name: "Cannot run 1" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Inactive 1" }));
    await waitFor(() => expect(listed()).toEqual(["Scheduled jobs"]));

    await user.click(screen.getByRole("button", { name: "All 3" }));
    await waitFor(() => expect(listed()).toHaveLength(3));
  });

  it("clears every filter at once", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Canceled job & techs");

    await user.click(screen.getByRole("button", { name: "Active 1" }));
    await waitFor(() => expect(listed()).toEqual(["Canceled job & techs"]));

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(listed()).toHaveLength(3));
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("says when nothing matches instead of showing an empty list", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Canceled job & techs");

    await user.type(screen.getByLabelText("Search automations"), "nothing like this");
    expect(await screen.findByRole("heading", { name: "No automations found" })).toBeInTheDocument();
    expect(screen.getByText(/couldn't find any automations based on your search/)).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^automation-/)).toHaveLength(0);
  });

  it("sorts by name", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Canceled job & techs");

    await user.click(screen.getByLabelText("Sort"));
    await user.click(await screen.findByRole("option", { name: "Name" }));
    await waitFor(() =>
      expect(listed()).toEqual(["Canceled job & techs", "Invoice due 7 days", "Scheduled jobs"]),
    );
  });

  it("offers only the categories the rules actually use, and lets one go on a second press", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Canceled job & techs");

    expect(screen.getByRole("button", { name: "Follow-ups 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Custom 2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Marketing/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Follow-ups 1" }));
    await waitFor(() => expect(listed()).toEqual(["Invoice due 7 days"]));

    await user.click(screen.getByRole("button", { name: "Follow-ups 1" }));
    await waitFor(() => expect(listed()).toHaveLength(3));
  });

  it("renames a rule in place from its menu", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Canceled job & techs");

    await user.click(screen.getByRole("button", { name: "Actions for Canceled job & techs" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const field = await screen.findByRole("textbox", { name: "Rule name" });
    await user.clear(field);
    await user.type(field, "Canceled jobs{Enter}");
    await waitFor(() => expect(patched).toEqual([{ id: "canceled", body: { name: "Canceled jobs" } }]));
  });
});

describe("AutomationsPage rule actions", () => {
  it("opens the builder from the Create automation button, on the steps a rule starts with", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Canceled job & techs");

    await user.click(screen.getByRole("button", { name: "Add automation" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Create automation" })).toBeInTheDocument();
    // Nothing to dry-run until the rule exists.
    expect(within(dialog).queryByRole("button", { name: /test against a job/i })).not.toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Name"), "Late tech");

    // The message is written in the step's own settings panel now, so what the
    // page answers for is that the builder opened on a chain — and that a rule
    // with nothing to send is not created from it.
    expect(within(dialog).getByRole("button", { name: /^Step 1, Trigger/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^Step 2, Send/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Add automation" })).toBeDisabled();
    expect(created).toEqual([]);
  });

  it("creates a rule from a library recipe", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Canceled job & techs");

    await user.click(screen.getByRole("tab", { name: "Discover" }));
    const missed = await screen.findByTestId("automation-template-missed-call-text-client");
    await user.click(within(missed).getByLabelText("Use Missed call / Immediate text client"));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Add automation" }));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({
      name: "Missed call / Immediate text client",
      // Off, and said so: a rule created by accident must not start texting.
      enabled: false,
      category: "phone",
      spec: { trigger: { kind: "call.completed", callOutcome: "missed", callDirection: "inbound" } },
    });
  });

  it("duplicates a rule from its menu, under a name that tells the two apart", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Canceled job & techs");

    await user.click(screen.getByRole("button", { name: "Actions for Canceled job & techs" }));
    await user.click(await screen.findByRole("menuitem", { name: "Duplicate" }));
    await waitFor(() =>
      expect(duplicated).toEqual([
        { id: "canceled", body: { name: "Canceled job & techs (copy)" } },
      ]),
    );
  });

  it("deletes a rule only after the confirm names it", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Canceled job & techs");

    await user.click(screen.getByRole("button", { name: "Actions for Canceled job & techs" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete Canceled job & techs" }));

    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText("Delete “Canceled job & techs”?")).toBeInTheDocument();
    expect(within(confirm).getByText(/can't be undone/)).toBeInTheDocument();
    expect(deleted).toEqual([]);

    await user.click(within(confirm).getByRole("button", { name: "Delete rule" }));
    await waitFor(() => expect(deleted).toEqual(["canceled"]));
  });

  it("walks away from the confirm without deleting", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Canceled job & techs");

    await user.click(screen.getByRole("button", { name: "Actions for Canceled job & techs" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete Canceled job & techs" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(deleted).toEqual([]);
  });

  it("edits a rule from its menu", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Canceled job & techs");

    await user.click(screen.getByRole("button", { name: "Actions for Canceled job & techs" }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
    expect(
      within(await screen.findByRole("dialog")).getByRole("heading", { name: "Edit automation" }),
    ).toBeInTheDocument();
  });

  it("reads the new recipe in when one draft is swapped for another", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Canceled job & techs");

    await user.click(screen.getByRole("tab", { name: "Discover" }));
    const missed = await screen.findByTestId("automation-template-missed-call-text-client");
    await user.click(within(missed).getByLabelText("Use Missed call / Immediate text client"));
    expect(await screen.findByLabelText("Name")).toHaveValue("Missed call / Immediate text client");

    // The editor reads its draft into form state once, as it mounts. The open
    // dialog hides the library from the pointer and from the accessibility
    // tree, so the second recipe is taken at its own card — the shape of the
    // path that would hand the editor a second draft without unmounting it.
    const answered = screen.getByTestId("automation-template-completed-call-text-client");
    fireEvent.click(within(answered).getByLabelText("Use Completed call / Text client"));

    await waitFor(() =>
      expect(screen.getByLabelText("Name")).toHaveValue("Completed call / Text client"),
    );
    // The chain is the second recipe's, not the first one's with a new name.
    expect(screen.getByRole("button", { name: /^Step 1, Trigger/ })).toHaveAccessibleName(
      "Step 1, Trigger: When a call is answered",
    );
  });

  it("reads the new rule in when the edited one is swapped for another", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Canceled job & techs");

    await user.click(screen.getByRole("button", { name: "Actions for Canceled job & techs" }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
    expect(await screen.findByRole("button", { name: /^Step 1, Trigger/ })).toHaveAccessibleName(
      "Step 1, Trigger: When a job has a status of Canceled",
    );

    // The editor reads its rule into chain state once, as it mounts. An open
    // dialog hides the list from the pointer and from the accessibility tree,
    // so the swap is driven at the card itself — the shape of the path that
    // would hand the editor a second rule without unmounting it first.
    const card = screen.getByTestId("automation-scheduled");
    fireEvent.pointerDown(within(card).getByLabelText("Actions for Scheduled jobs"), { button: 0 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));

    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("Scheduled jobs"));
    expect(screen.getByRole("button", { name: /^Step 1, Trigger/ })).toHaveAccessibleName(
      "Step 1, Trigger: When a job changes",
    );
  });
});
