import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { TooltipProvider } from "@/components/ui/tooltip";
import { server } from "@/test/msw/server";
import type { InboxConversation, SendMessageBody } from "../api";
import { Composer } from "./composer";

type OnSend = (body: SendMessageBody) => Promise<unknown>;

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true, me: { id: "me" }, isLoading: false, isTechnician: false }),
}));

const conversation: InboxConversation = {
  id: "c1",
  kind: "client",
  partyKind: "contact",
  partyId: "ct1",
  addresses: { phones: ["+14045551234"], emails: [] },
  state: "open",
  unread: false,
  unreadCount: 0,
  flagged: false,
  lastBusinessNumber: "+12025550100",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-15T10:00:00.000Z",
};

const renderCalls: unknown[] = [];
const previewCalls: unknown[] = [];

beforeEach(() => {
  renderCalls.length = 0;
  previewCalls.length = 0;
  server.use(
    http.get("*/telephony/numbers", () =>
      HttpResponse.json({
        success: true,
        data: [
          { sid: "PN1", phoneNumber: "+12025550100", friendlyName: "Main" },
          { sid: "PN2", phoneNumber: "+12025550199", friendlyName: "Second" },
        ],
      }),
    ),
    http.get("*/messaging/templates/short-codes", () =>
      HttpResponse.json({
        success: true,
        data: [
          { code: "first_name", group: "client", description: "Client first name", example: "Jane" },
          { code: "job_date", group: "job", description: "Scheduled date", example: "Sep 15" },
        ],
      }),
    ),
    http.get("*/messaging/templates", () =>
      HttpResponse.json({
        success: true,
        data: [
          {
            id: "t1",
            messageTemplateTitle: "On my way",
            messageTemplate: "<p>Hi {{first_name}}, your tech is on the way.</p>",
            channel: "sms",
            isDefault: true,
            category: "Dispatch",
            active: true,
            createdBy: "u",
            createdAt: "x",
            updatedAt: "x",
          },
        ],
      }),
    ),
    http.post("*/messaging/templates/t1/render", async ({ request }) => {
      renderCalls.push(await request.json());
      return HttpResponse.json({
        success: true,
        data: { body: "Hi Jane, your tech is on the way.", missing: [] },
      });
    }),
    http.post("*/messaging/templates/preview", async ({ request }) => {
      previewCalls.push(await request.json());
      return HttpResponse.json({
        success: true,
        data: { body: "See you Sep 15, Jane", missing: [] },
      });
    }),
  );
});

function renderComposer(props: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSend = vi.fn<OnSend>(async () => undefined);
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <Composer conversation={conversation} onSend={onSend} {...props} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { onSend };
}

describe("Composer", () => {
  it("counts GSM-7 and UCS-2 segments as you type", async () => {
    renderComposer();
    const box = screen.getByLabelText("Message");
    expect(screen.getByTestId("segment-counter")).toHaveTextContent("GSM-7 · 0/160 · 1 segment");

    await userEvent.type(box, "Hello there");
    expect(screen.getByTestId("segment-counter")).toHaveTextContent("GSM-7 · 11/160 · 1 segment");

    await userEvent.type(box, " 👍");
    expect(screen.getByTestId("segment-counter")).toHaveTextContent(/UCS-2 · 14\/70/);
  });

  it("sends on Enter with a fresh clientMessageId and keeps Shift+Enter as a new line", async () => {
    const { onSend } = renderComposer({ dealId: "d1" });
    const box = screen.getByLabelText("Message");

    await userEvent.type(box, "Line one{Shift>}{Enter}{/Shift}Line two");
    expect(onSend).not.toHaveBeenCalled();
    await userEvent.type(box, "{Enter}");

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    const body = onSend.mock.calls[0][0];
    expect(body.body).toBe("Line one\nLine two");
    expect(body.channel).toBe("sms");
    expect(body.dealId).toBe("d1");
    expect(body.clientMessageId).toMatch(/^[0-9a-f-]{36}$/);
    // Cleared after a successful send.
    expect(box).toHaveValue("");
  });

  it("keeps the draft when the send is refused", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onSend = vi.fn<OnSend>(async () => {
      throw new Error("nope");
    });
    render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <Composer conversation={conversation} onSend={onSend} />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    await userEvent.type(screen.getByLabelText("Message"), "keep me{Enter}");
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(screen.getByLabelText("Message")).toHaveValue("keep me");
  });

  it("blocks sending to an opted-out number", async () => {
    renderComposer({ optedOut: true });
    expect(screen.getByLabelText("Message")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByText(/opted out/)).toBeInTheDocument();
  });

  it("renders a picked template against the thread and records the template id", async () => {
    const { onSend } = renderComposer();
    await userEvent.click(screen.getByRole("button", { name: "Insert a template" }));
    await userEvent.click(await screen.findByText("On my way"));

    await waitFor(() => expect(screen.getByLabelText("Message")).toHaveValue("Hi Jane, your tech is on the way."));
    expect(renderCalls[0]).toEqual({ conversationId: "c1", contactId: "ct1" });

    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0][0].templateId).toBe("t1");
  });

  it("inserts a short code at the caret and fills it in before a template-less send", async () => {
    const { onSend } = renderComposer();
    const box = screen.getByLabelText("Message");
    await userEvent.type(box, "See you ");
    await userEvent.click(screen.getByRole("button", { name: "Insert a short code" }));
    await userEvent.click(await screen.findByText("{{job_date}}"));
    await waitFor(() => expect(box).toHaveValue("See you {{job_date}}"));

    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(previewCalls[0]).toMatchObject({ body: "See you {{job_date}}", conversationId: "c1", keepMissing: false });
    expect(onSend.mock.calls[0][0].body).toBe("See you Sep 15, Jane");
  });

  it("preselects the number the client last heard from and sends it explicitly", async () => {
    const { onSend } = renderComposer();
    expect(await screen.findByLabelText("Send from")).toHaveTextContent("(202) 555-0100");

    await userEvent.type(screen.getByLabelText("Message"), "hi{Enter}");
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0][0].fromNumber).toBe("+12025550100");
  });

  it("refuses a body over the SMS ceiling", async () => {
    renderComposer();
    const box = screen.getByLabelText("Message");
    await userEvent.click(box);
    await userEvent.paste("a".repeat(1601));
    expect(screen.getByTestId("segment-counter")).toHaveTextContent("too long");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});
