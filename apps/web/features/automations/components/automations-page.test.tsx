import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
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
    notRunnableReason: "Workiz invoice rules have no BitCRM equivalent",
    workizTriggered: 5,
    createdAt: "2026-09-15T10:00:00.000Z",
    updatedAt: "2026-09-15T10:00:00.000Z",
  },
];

const patched: Array<{ id: string; body: unknown }> = [];

beforeEach(() => {
  patched.length = 0;
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
    http.patch("*/messaging/automations/:id", async ({ params, request }) => {
      patched.push({ id: String(params.id), body: await request.json() });
      const rule = rules.find((r) => r.id === String(params.id));
      return HttpResponse.json({ success: true, data: { ...rule, enabled: true } });
    }),
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

describe("AutomationsPage", () => {
  it("lists the rules with the Workiz sentence and the firing counts", async () => {
    renderPage();

    expect(await screen.findByText("Canceled job & techs")).toBeInTheDocument();
    expect(
      screen.getByText(
        "When a job has a status of canceled and it has a technician, send the assigned tech a text message immediately",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
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
    const row = await screen.findByTestId("automation-invoice");
    expect(within(row).getByRole("switch")).toBeDisabled();
    expect(within(row).getByText("Cannot run here")).toBeInTheDocument();
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
