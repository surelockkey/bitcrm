import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse, delay } from "msw";
import { server } from "@/test/msw/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AutomationsPage } from "./automations-page";

vi.mock("@/features/auth/use-permissions", () => ({
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
const duplicated: string[] = [];
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
    http.post("*/messaging/automations/:id/duplicate", ({ params }) => {
      duplicated.push(String(params.id));
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
    expect(
      screen.getByText(
        "When a job has a status of canceled and it has a technician, send the assigned tech a text message immediately",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Firing log of Canceled job & techs" })).toHaveTextContent(
      "12 firings",
    );
    expect(screen.getByText("5,411 in Workiz")).toBeInTheDocument();
    expect(screen.getByText(/1 of 3 rules are on\./)).toBeInTheDocument();
  });

  it("names the job tag from the catalog instead of its id", async () => {
    renderPage();
    expect(await screen.findByText(/its job tag is SCHEDULED/)).toBeInTheDocument();
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

    await user.click(await screen.findByRole("button", { name: /re-check imported rules/i }));
    await waitFor(() => expect(migrated).toBe(1));
  });

  it("shows the firing log for a rule", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Firing log of Canceled job & techs" }));
    const runs = await screen.findByTestId("automation-runs");
    expect(within(runs).getByText("deal:d1 · 1 sent")).toBeInTheDocument();
    expect(within(runs).getByText("Sent")).toBeInTheDocument();
  });
});

describe("AutomationsPage tabs", () => {
  it("opens on the rules the workspace already has, and counts them on the tab", async () => {
    renderPage();

    expect(await screen.findByRole("tab", { name: "My automations · 3" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Library" })).toHaveAttribute("aria-selected", "false");
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
    expect(screen.getByRole("tab", { name: /My automations/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    expect(await screen.findByRole("tab", { name: "Library", selected: true })).toBeInTheDocument();
    expect(screen.getByText("No recipes yet")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "My automations · 0" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("waits on the rules with their skeleton, not with the library", async () => {
    server.use(
      http.get("*/messaging/automations", async () => {
        await delay(20);
        return HttpResponse.json({ success: true, data: rules });
      }),
    );
    renderPage();

    expect(screen.getByRole("tab", { name: /My automations/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(screen.queryByText("No recipes yet")).not.toBeInTheDocument();

    expect(await screen.findByText("Canceled job & techs")).toBeInTheDocument();
  });

  it("lets the reader cross to the library and back", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "Library" }));
    expect(await screen.findByText("No recipes yet")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "My automations · 3" }));
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
    expect(screen.getByText("1 of 3 rules")).toBeInTheDocument();
  });

  it("narrows to one state with the chips", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Canceled job & techs");

    await user.click(screen.getByRole("button", { name: "Cannot run" }));
    await waitFor(() => expect(listed()).toEqual(["Invoice due 7 days"]));
  });

  it("clears every filter at once", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Canceled job & techs");

    await user.click(screen.getByRole("button", { name: "On" }));
    await waitFor(() => expect(listed()).toEqual(["Canceled job & techs"]));

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(listed()).toHaveLength(3));
    expect(screen.getByText("3 rules")).toBeInTheDocument();
  });

  it("says when nothing matches instead of showing an empty list", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Canceled job & techs");

    await user.type(screen.getByLabelText("Search automations"), "nothing like this");
    expect(await screen.findByText("No rule matches these filters")).toBeInTheDocument();
    expect(screen.getByText("0 of 3 rules")).toBeInTheDocument();
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

  it("offers only the categories the rules actually use", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Canceled job & techs");

    await user.click(screen.getByLabelText("Category"));
    expect(await screen.findByRole("option", { name: "Follow-ups" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Custom" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Marketing" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: "Follow-ups" }));
    await waitFor(() => expect(listed()).toEqual(["Invoice due 7 days"]));
  });
});

describe("AutomationsPage rule actions", () => {
  it("creates a rule from the Create automation button", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Canceled job & techs");

    await user.click(screen.getByRole("button", { name: "Create automation" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Create automation" })).toBeInTheDocument();
    // Nothing to dry-run until the rule exists.
    expect(within(dialog).queryByRole("button", { name: /test against a job/i })).not.toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Name"), "Late tech");
    await user.type(within(dialog).getByLabelText("Message"), "Running late");
    await user.click(within(dialog).getByRole("button", { name: "Create automation" }));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({
      name: "Late tech",
      spec: { actions: [{ type: "send_sms", to: "client", body: "Running late" }] },
    });
  });

  it("duplicates a rule from its menu", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Canceled job & techs");

    await user.click(screen.getByRole("button", { name: "Actions for Canceled job & techs" }));
    await user.click(await screen.findByRole("menuitem", { name: "Duplicate" }));
    await waitFor(() => expect(duplicated).toEqual(["canceled"]));
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
});
