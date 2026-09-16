import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
    http.get("*/deals/job-sources", () => HttpResponse.json({ success: true, data: [] })),
    http.get("*/deals/job-statuses", () => HttpResponse.json({ success: true, data: [] })),
    http.get("*/messaging/templates/short-codes", () => HttpResponse.json({ success: true, data: [] })),
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

describe("AutomationFormDialog", () => {
  it("opens on the rule's own trigger, conditions and message", async () => {
    renderDialog();

    expect(await screen.findByDisplayValue("Scheduled jobs")).toBeInTheDocument();
    expect(screen.getByLabelText("Trigger")).toHaveTextContent("Job matches");
    expect(screen.getByLabelText("Condition 1 field")).toHaveTextContent("Job status");
    expect(screen.getByLabelText("Condition 2 field")).toHaveTextContent("Job tag");
    expect(screen.getByLabelText("Action 1 recipient")).toHaveTextContent("Assigned technicians");
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("New scheduled job {{job_id}}");
  });

  it("previews the rule as a sentence and keeps it in step with the form", async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(
      await screen.findByText(
        "When a job has a status of Submitted and its job tag is SCHEDULED, send the assigned tech a text message immediately",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByLabelText("Delay"));
    await user.click(await screen.findByRole("option", { name: "After 1 day" }));
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
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("Sorry we missed you");
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
