import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { AutomationRule, AutomationRun } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { AutomationRunsDialog } from "./automation-runs-dialog";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const rule = {
  id: "rule-1",
  name: "Canceled job & techs",
  enabled: true,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
} as AutomationRule;

const LONG_BODY =
  "Hi Ann, the job at 1200 Main St on Sep 16 has been canceled by the client.\nPlease do not drive out — dispatch will call you with the next one.";

const runs: AutomationRun[] = [
  {
    id: "run-1",
    ruleId: "rule-1",
    firedAt: "2026-09-16T15:04:00.000Z",
    trigger: "deal.status_changed",
    entity: "deal:d-1",
    dealId: "d-1",
    occurrence: "canceled",
    outcome: "sent",
    actions: [
      {
        type: "send_sms",
        to: "Ann (tech)",
        outcome: "sent",
        body: LONG_BODY,
        messageId: "m-1",
        conversationId: "conv-1",
      },
    ],
  },
  {
    id: "run-2",
    ruleId: "rule-1",
    firedAt: "2026-09-16T14:00:00.000Z",
    trigger: "deal.status_changed",
    entity: "deal:d-2",
    occurrence: "canceled",
    outcome: "skipped",
    actions: [],
    reason: "the job has no technician",
  },
  {
    id: "run-3",
    ruleId: "rule-1",
    firedAt: "2026-09-16T13:00:00.000Z",
    trigger: "call.completed",
    entity: "call:CA123",
    occurrence: "completed",
    outcome: "sent",
    actions: [{ type: "send_sms", to: "the client", outcome: "sent", body: "Sorry we missed you." }],
  },
  {
    id: "run-4",
    ruleId: "rule-1",
    firedAt: "2026-09-16T12:00:00.000Z",
    trigger: "message.received",
    entity: "message:msg-7",
    occurrence: "msg-7",
    outcome: "sent",
    actions: [
      { type: "send_sms", to: "the client", outcome: "sent", body: "Thanks!", conversationId: "conv-9" },
    ],
  },
  {
    id: "run-5",
    ruleId: "rule-1",
    firedAt: "2026-09-16T11:00:00.000Z",
    trigger: "deal.updated",
    entity: "deal:unknown",
    occurrence: "x",
    outcome: "failed",
    actions: [{ type: "send_email", to: "client", outcome: "unsupported", error: "SMS only for now" }],
  },
];

beforeEach(() => {
  server.use(
    http.get("*/messaging/automations/:id/runs", () =>
      HttpResponse.json({ success: true, data: runs }),
    ),
  );
});

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AutomationRunsDialog rule={rule} open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

describe("AutomationRunsDialog", () => {
  it("shows the message that went out and who it went to", async () => {
    renderDialog();

    const row = within(await screen.findByTestId("firing-run-1"));
    expect(row.getByText("Text message")).toBeInTheDocument();
    expect(row.getByText(/to Ann \(tech\)/)).toBeInTheDocument();
    expect(row.getByText(/has been canceled by the client/)).toBeInTheDocument();
  });

  it("links a job firing to the job itself", async () => {
    renderDialog();

    const log = await screen.findByTestId("automation-runs");
    expect(within(log).getByRole("link", { name: "Open job d-1" })).toHaveAttribute(
      "href",
      "/deals/d-1",
    );
  });

  it("collapses a long message until the reader asks for it", async () => {
    const user = userEvent.setup();
    renderDialog();

    const body = await screen.findByText(/has been canceled by the client/);
    expect(body).toHaveClass("line-clamp-2");

    await user.click(screen.getByRole("button", { name: "Show the whole message" }));
    expect(body).not.toHaveClass("line-clamp-2");

    await user.click(screen.getByRole("button", { name: "Show less" }));
    expect(body).toHaveClass("line-clamp-2");
  });

  it("says whether the whole message is showing", async () => {
    const user = userEvent.setup();
    renderDialog();

    const toggle = await screen.findByRole("button", { name: "Show the whole message" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("wraps a message with no space in it instead of stretching the row", async () => {
    const link = `https://track.example.com/${"a".repeat(200)}`;
    server.use(
      http.get("*/messaging/automations/:id/runs", () =>
        HttpResponse.json({
          success: true,
          data: [
            {
              ...runs[0],
              id: "run-9",
              actions: [{ type: "send_sms", to: "the client", outcome: "sent", body: link }],
            },
          ],
        }),
      ),
    );
    renderDialog();

    expect(await screen.findByText(link)).toHaveClass("break-words");
  });

  it("escapes what it puts in a link, so an odd id cannot rewrite the url", async () => {
    server.use(
      http.get("*/messaging/automations/:id/runs", () =>
        HttpResponse.json({
          success: true,
          data: [
            {
              ...runs[0],
              id: "run-8",
              entity: "deal:d/1",
              dealId: undefined,
              actions: [
                {
                  type: "send_sms",
                  to: "the client",
                  outcome: "sent",
                  body: "hi",
                  conversationId: "c&v=1",
                },
              ],
            },
          ],
        }),
      ),
    );
    renderDialog();

    expect(await screen.findByRole("link", { name: "Open job d/1" })).toHaveAttribute(
      "href",
      "/deals/d%2F1",
    );
    expect(screen.getByRole("link", { name: "Open the thread" })).toHaveAttribute(
      "href",
      "/messages?c=c%26v%3D1",
    );
  });

  it("gives the reason for a firing that did nothing", async () => {
    renderDialog();

    expect(
      await screen.findByText(/Nothing was sent — the job has no technician/),
    ).toBeInTheDocument();
  });

  it("gives that reason once, not once as a summary and once again in full", async () => {
    renderDialog();

    const row = within(await screen.findByTestId("firing-run-2"));
    expect(row.getAllByText(/the job has no technician/)).toHaveLength(1);
    // The firing is still said to be about a job.
    expect(row.getByRole("link", { name: "Open job d-2" })).toBeInTheDocument();
  });

  it("says a call is a call and links to it, instead of printing the sid", async () => {
    renderDialog();

    const log = await screen.findByTestId("automation-runs");
    expect(within(log).getByText("A phone call")).toBeInTheDocument();
    expect(within(log).getByRole("link", { name: "Open the call CA123" })).toHaveAttribute(
      "href",
      "/calls/CA123",
    );
  });

  it("says a message firing is a message, and links the thread it answered in", async () => {
    renderDialog();

    const row = within(await screen.findByTestId("firing-run-4"));
    expect(row.getByText("An incoming message")).toBeInTheDocument();
    expect(row.getByRole("link", { name: "Open the thread" })).toHaveAttribute(
      "href",
      "/messages?c=conv-9",
    );
  });

  it("does not offer a dead link for a firing whose event named no job", async () => {
    renderDialog();

    const log = await screen.findByTestId("automation-runs");
    expect(within(log).getByText("A job the event did not name")).toBeInTheDocument();
    expect(within(log).queryByRole("link", { name: "Open job unknown" })).not.toBeInTheDocument();
    // An action the engine cannot run yet says so rather than looking sent.
    expect(within(log).getByText("Not supported here")).toBeInTheDocument();
    expect(within(log).getByText("SMS only for now")).toBeInTheDocument();
  });

  it("offers the whole history of this rule on the activity page", async () => {
    renderDialog();

    expect(
      await screen.findByRole("link", { name: "See every firing of this rule in Activity" }),
    ).toHaveAttribute("href", "/automations/activity?rule=rule-1");
  });

  it("a request that failed is not a rule that never fired", async () => {
    server.use(
      http.get("*/messaging/automations/:id/runs", () =>
        HttpResponse.json(
          { success: false, error: { code: "BOOM", message: "The log is down" } },
          { status: 500 },
        ),
      ),
    );
    renderDialog();

    expect(await screen.findByText(/The log could not be loaded\. The log is down/)).toBeInTheDocument();
    expect(screen.queryByText("It has not fired here yet.")).not.toBeInTheDocument();
  });

  it("says plainly when the rule has never fired here", async () => {
    server.use(
      http.get("*/messaging/automations/:id/runs", () =>
        HttpResponse.json({ success: true, data: [] }),
      ),
    );
    renderDialog();

    expect(await screen.findByText("It has not fired here yet.")).toBeInTheDocument();
  });
});
