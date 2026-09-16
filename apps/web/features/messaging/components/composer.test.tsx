import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
    http.get("*/messaging/templates", ({ request }) =>
      HttpResponse.json({
        success: true,
        data:
          new URL(request.url).searchParams.get("channel") === "email"
            ? []
            : [
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
                {
                  id: "t2",
                  messageTemplateTitle: "Pictures request",
                  messageTemplate: "<p>Please attach the pictures here.</p>",
                  channel: "sms",
                  isDefault: false,
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
    http.post("*/messaging/templates/t2/render", async ({ request }) => {
      renderCalls.push(await request.json());
      return HttpResponse.json({ success: true, data: { body: "Please attach the pictures here.", missing: [] } });
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
  it("looks like Workiz: the box with sparkle and paperclip inside, and a Send Text button", async () => {
    renderComposer();
    expect(screen.getByPlaceholderText("Type your message here...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI suggestions" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Attach a file" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send Text" })).toBeDisabled();
    // No email address on this thread: the chevron only carries the sending number.
    await userEvent.click(await screen.findByRole("button", { name: "Send options" }));
    expect(await screen.findByText("Send from")).toBeInTheDocument();
    expect(screen.queryByText("Send as")).toBeNull();
  });

  it("counts GSM-7 and UCS-2 segments as you type, showing the counter only once there is text", async () => {
    renderComposer();
    const box = screen.getByLabelText("Message");
    expect(screen.queryByTestId("segment-counter")).toBeNull();

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
    expect(screen.getByRole("button", { name: "Send Text" })).toBeDisabled();
    expect(screen.getByText(/opted out/)).toBeInTheDocument();
  });

  it("shows the templates as quick-reply chips; a chip renders the template against the thread", async () => {
    const { onSend } = renderComposer();
    const chips = await screen.findByLabelText("Quick replies");
    expect(within(chips).getAllByRole("button").map((b) => b.textContent)).toEqual(["On my way", "Pictures request"]);

    await userEvent.click(within(chips).getByRole("button", { name: "On my way" }));
    await waitFor(() => expect(screen.getByLabelText("Message")).toHaveValue("Hi Jane, your tech is on the way."));
    expect(renderCalls[0]).toEqual({ conversationId: "c1", contactId: "ct1" });

    await userEvent.click(screen.getByRole("button", { name: "Send Text" }));
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0][0].templateId).toBe("t1");
  });

  it("opens the full list behind More replies", async () => {
    renderComposer();
    await userEvent.click(await screen.findByRole("button", { name: "More replies" }));
    const picker = await screen.findByTestId("template-picker");
    await userEvent.click(within(picker).getByText("Pictures request"));
    await waitFor(() => expect(screen.getByLabelText("Message")).toHaveValue("Please attach the pictures here."));
  });

  it("opens with forwarded text", () => {
    renderComposer({ initialText: "Forwarded: see you at 3" });
    expect(screen.getByLabelText("Message")).toHaveValue("Forwarded: see you at 3");
    expect(screen.getByRole("button", { name: "Send Text" })).toBeEnabled();
  });

  it("inserts a short code at the caret and fills it in before a template-less send", async () => {
    const { onSend } = renderComposer();
    const box = screen.getByLabelText("Message");
    await userEvent.type(box, "See you ");
    await userEvent.click(screen.getByRole("button", { name: "Insert a short code" }));
    await userEvent.click(await screen.findByText("{{job_date}}"));
    await waitFor(() => expect(box).toHaveValue("See you {{job_date}}"));

    await userEvent.click(screen.getByRole("button", { name: "Send Text" }));
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(previewCalls[0]).toMatchObject({ body: "See you {{job_date}}", conversationId: "c1", keepMissing: false });
    expect(onSend.mock.calls[0][0].body).toBe("See you Sep 15, Jane");
  });

  it("preselects the number the client last heard from behind the chevron and sends it explicitly", async () => {
    const { onSend } = renderComposer();
    await userEvent.click(await screen.findByRole("button", { name: "Send options" }));
    const main = await screen.findByRole("menuitemradio", { name: /\(202\) 555-0100/ });
    expect(main).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{Escape}");

    await userEvent.type(screen.getByLabelText("Message"), "hi{Enter}");
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0][0].fromNumber).toBe("+12025550100");
  });

  it("switches to Email behind the chevron when the thread has an address, with a subject line", async () => {
    const { onSend } = renderComposer({
      conversation: { ...conversation, addresses: { phones: ["+14045551234"], emails: ["jane@example.com"] } },
    });
    await userEvent.click(await screen.findByRole("button", { name: "Send options" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "Email" }));

    expect(screen.getByRole("button", { name: "Send Email" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Subject"), "Your quote");
    await userEvent.type(screen.getByLabelText("Message"), "Attached below{Enter}");
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0][0]).toMatchObject({ channel: "email", subject: "Your quote", body: "Attached below" });
    expect(onSend.mock.calls[0][0].fromNumber).toBeUndefined();
  });

  it("refuses a body over the SMS ceiling", async () => {
    renderComposer();
    const box = screen.getByLabelText("Message");
    await userEvent.click(box);
    await userEvent.paste("a".repeat(1601));
    expect(screen.getByTestId("segment-counter")).toHaveTextContent("too long");
    expect(screen.getByRole("button", { name: "Send Text" })).toBeDisabled();
  });
});
