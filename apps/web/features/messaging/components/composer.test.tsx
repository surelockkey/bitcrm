import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { ConversationSendOptions } from "@bitcrm/types";
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

/** What `GET /conversations/:id/send-options` would answer for this thread. */
function sendOptions(data: Partial<ConversationSendOptions> & { channels: ConversationSendOptions["channels"] }) {
  server.use(
    http.get("*/messaging/conversations/:id/send-options", ({ params }) =>
      HttpResponse.json({
        success: true,
        data: { conversationId: params.id, defaultChannel: data.channels.find((c) => c.available)?.channel, ...data },
      }),
    ),
  );
}

/** The usual client thread: a number that can be texted, an address that can be mailed. */
const CLIENT_CHANNELS: ConversationSendOptions["channels"] = [
  { channel: "sms", available: true, to: "+14045551234", from: "+12025550100", fromSource: "sticky" },
  { channel: "email", available: true, to: "jane@example.com", from: "office@surelock.test" },
  { channel: "in_app", available: false, reason: "not_a_team_thread" },
];

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


/**
 * Sending, the way the composer now works: the paper plane opens the choice
 * and choosing is the send. Anywhere a test used to press "Send Text" once, it
 * presses the plane and then names the channel.
 */
async function sendVia(u: ReturnType<typeof userEvent.setup>, channel: "Text" | "Email" | "In App") {
  await u.click(screen.getByRole("button", { name: /^send (text|email|in app)$/i }));
  await u.click(await screen.findByRole("menuitemradio", { name: channel }));
}

describe("Composer", () => {
  it("looks like Workiz: the box with sparkle and paperclip inside, and a Send Text button", async () => {
    renderComposer();
    expect(screen.getByPlaceholderText("Type your message here...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI suggestions" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Attach a file" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send Text" })).toBeDisabled();
    await userEvent.click(await screen.findByRole("button", { name: /^send (text|email|in app)$/i }));
    // All three ways out, and the number this text would be sent from.
    expect(await screen.findByText("Send as")).toBeInTheDocument();
    expect(await screen.findByText("Send from")).toBeInTheDocument();
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

    await sendVia(userEvent.setup({ pointerEventsCheck: 0 }), "Text");
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

    await sendVia(userEvent.setup({ pointerEventsCheck: 0 }), "Text");
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(previewCalls[0]).toMatchObject({ body: "See you {{job_date}}", conversationId: "c1", keepMissing: false });
    expect(onSend.mock.calls[0][0].body).toBe("See you Sep 15, Jane");
  });

  it("preselects the number the client last heard from behind the chevron and sends it explicitly", async () => {
    const { onSend } = renderComposer();
    await userEvent.click(await screen.findByRole("button", { name: /^send (text|email|in app)$/i }));
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
    await userEvent.click(await screen.findByRole("button", { name: /^send (text|email|in app)$/i }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "Email" }));

    expect(screen.getByRole("button", { name: "Send Email" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Subject"), "Your quote");
    await userEvent.type(screen.getByLabelText("Message"), "Attached below{Enter}");
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0][0]).toMatchObject({ channel: "email", subject: "Your quote", body: "Attached below" });
    expect(onSend.mock.calls[0][0].fromNumber).toBeUndefined();
  });

  it("offers all three channels and says why in-app is not one of them on a client's thread", async () => {
    sendOptions({ channels: CLIENT_CHANNELS });
    renderComposer();

    await userEvent.click(await screen.findByRole("button", { name: /^send (text|email|in app)$/i }));
    expect(await screen.findByRole("menuitemradio", { name: "Text" })).toBeEnabled();
    expect(await screen.findByRole("menuitemradio", { name: "Email" })).toBeEnabled();
    const inApp = await screen.findByRole("menuitemradio", { name: /^In App — unavailable: In-app messages reach teammates/ });
    expect(inApp).toHaveAttribute("aria-disabled", "true");
  });

  it("shows where the message is going and what it goes out from, before it is sent", async () => {
    sendOptions({ channels: CLIENT_CHANNELS });
    renderComposer();

    const note = await screen.findByTestId("send-destination");
    await waitFor(() => expect(note).toHaveTextContent("To (404) 555-1234 · from (202) 555-0100"));
  });

  it("warns above the box when the thread can send nothing at all, and refuses to try", async () => {
    sendOptions({
      channels: [
        { channel: "sms", available: false, reason: "no_phone" },
        { channel: "email", available: false, reason: "no_email" },
        { channel: "in_app", available: false, reason: "not_a_team_thread" },
      ],
    });
    const { onSend } = renderComposer({
      conversation: { ...conversation, addresses: { phones: [], emails: [] } },
    });

    const warning = await screen.findByTestId("composer-warning");
    expect(warning).toHaveTextContent("Nothing can be sent from this thread.");
    expect(warning).toHaveTextContent("No phone number on this conversation");
    expect(warning).toHaveTextContent("No email address on this conversation");

    await userEvent.type(screen.getByLabelText("Message"), "hello{Enter}");
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Send Text/ })).toBeDisabled();
  });

  it("names the number a text would leave to when the recipient replied STOP, rather than failing on send", async () => {
    sendOptions({
      channels: [
        { channel: "sms", available: false, reason: "opted_out_sms", to: "+14045551234" },
        { channel: "email", available: true, to: "jane@example.com", from: "office@surelock.test" },
        { channel: "in_app", available: false, reason: "not_a_team_thread" },
      ],
    });
    renderComposer({
      conversation: { ...conversation, addresses: { phones: ["+14045551234"], emails: ["jane@example.com"] } },
    });

    // The thread can still be mailed, so that is what the control opens on.
    expect(await screen.findByRole("button", { name: "Send Email" })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /^send (text|email|in app)$/i }));
    expect(await screen.findByRole("menuitemradio", { name: /^Text — unavailable: They replied STOP/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("opens a teammate's thread on the in-app line and sends it there, with their own number behind the chevron", async () => {
    const team: InboxConversation = {
      ...conversation,
      kind: "team",
      partyKind: "user",
      partyId: "u2",
      addresses: { phones: [], emails: [] },
    };
    sendOptions({
      channels: [
        { channel: "in_app", available: true, toName: "Ann Tech" },
        { channel: "sms", available: true, to: "+14045550002", toName: "Ann Tech", from: "+12025550100" },
        { channel: "email", available: false, reason: "no_email" },
      ],
    });
    const { onSend } = renderComposer({ conversation: team });

    expect(await screen.findByRole("button", { name: "Send In App" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("send-destination")).toHaveTextContent("To Ann Tech"));

    await userEvent.click(await screen.findByRole("button", { name: /^send (text|email|in app)$/i }));
    expect(await screen.findByRole("menuitemradio", { name: "Text" })).toBeEnabled();
    await userEvent.keyboard("{Escape}");

    await userEvent.type(screen.getByLabelText("Message"), "job 1001 is yours{Enter}");
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    const body = onSend.mock.calls[0][0];
    expect(body.channel).toBe("in_app");
    // An in-app line belongs to the thread: no subject, nobody's phone bill.
    expect(body.subject).toBeUndefined();
    expect(body.fromNumber).toBeUndefined();
  });

  it("keeps a typed subject for the email and says so rather than dropping it into a text", async () => {
    sendOptions({ channels: CLIENT_CHANNELS });
    const { onSend } = renderComposer({
      conversation: { ...conversation, addresses: { phones: ["+14045551234"], emails: ["jane@example.com"] } },
    });

    await userEvent.click(await screen.findByRole("button", { name: /^send (text|email|in app)$/i }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "Email" }));
    await userEvent.type(screen.getByLabelText("Subject"), "Your quote");

    await userEvent.click(screen.getByRole("button", { name: /^send (text|email|in app)$/i }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "Text" }));
    expect(await screen.findByText(/The subject line is kept for the email/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Message"), "quote is on its way{Enter}");
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0][0]).toMatchObject({ channel: "sms" });
    expect(onSend.mock.calls[0][0].subject).toBeUndefined();
  });

  it("will not send an email without a subject, and says which is missing", async () => {
    sendOptions({ channels: CLIENT_CHANNELS });
    const { onSend } = renderComposer({
      conversation: { ...conversation, addresses: { phones: ["+14045551234"], emails: ["jane@example.com"] } },
    });

    await userEvent.click(await screen.findByRole("button", { name: /^send (text|email|in app)$/i }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "Email" }));
    await userEvent.type(screen.getByLabelText("Message"), "attached{Enter}");

    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByTestId("send-destination")).toHaveTextContent("An email needs a subject");
    await userEvent.type(screen.getByLabelText("Subject"), "Your quote");
    await sendVia(userEvent.setup({ pointerEventsCheck: 0 }), "Email");
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0][0]).toMatchObject({ channel: "email", subject: "Your quote" });
  });

  it("tells a viewer who may not see digits that the number is hidden, not missing", async () => {
    sendOptions({
      channels: [
        { channel: "sms", available: true, toMasked: true, from: "+12025550100" },
        { channel: "email", available: false, reason: "no_email" },
        { channel: "in_app", available: false, reason: "not_a_team_thread" },
      ],
    });
    renderComposer({ conversation: { ...conversation, addresses: { phones: [], emails: [] }, phonesMasked: true } });

    await waitFor(() =>
      expect(screen.getByTestId("send-destination")).toHaveTextContent("To a number you can't see"),
    );
    expect(screen.queryByTestId("composer-warning")).toBeNull();
  });

  it("refuses a body over the SMS ceiling", async () => {
    renderComposer();
    const box = screen.getByLabelText("Message");
    await userEvent.click(box);
    await userEvent.paste("a".repeat(1601));
    expect(screen.getByTestId("segment-counter")).toHaveTextContent("too long");
    expect(screen.getByRole("button", { name: "Send Text" })).toBeDisabled();
  });

  /**
   * Workiz's picker is three words — Text, Email, In App. Ours spelled the
   * destination out under each one, which is noise on a channel that plainly
   * works. The words are kept for the channel that does NOT work, where they
   * are the difference between a wrong guess and an explanation.
   */
  it("names a working channel and says no more about it", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    renderComposer();

    await u.click(screen.getByRole("button", { name: /^send (text|email|in app)$/i }));

    const text = await screen.findByRole("menuitemradio", { name: "Text" });
    expect(text).toBeInTheDocument();
  });

  /**
   * Workiz sends with a round yellow button carrying a paper plane, and names
   * the channel beside it. The button said "Send Text" in words, which made
   * the channel look like part of the button rather than a choice.
   */
  it("sends with one round button, named for anyone who cannot read the icon", async () => {
    renderComposer();

    const send = await screen.findByRole("button", { name: /^send (text|email|in app)$/i });
    // Sized, not padded: the repo's own guard allows a circle only when it is
    // a circle.
    expect(send.className).toMatch(/rounded-full/);
    expect(send.className).toMatch(/size-10/);
  });

  /**
   * The picker opens above the send button, as Workiz's does. It is not made a
   * gate in front of sending: every thread has a channel of its own — a
   * client's is a text, a teammate's is in-app — and making the common send
   * two clicks would cost more than the rare wrong guess it prevents.
   */
  it("opens the choice over the send button, without standing in its way", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    const { onSend } = renderComposer();

    await u.type(screen.getByPlaceholderText(/type your message/i), "hello");
    await u.click(screen.getByRole("button", { name: /^send (text|email|in app)$/i }));

    expect(await screen.findByRole("menuitemradio", { name: "Text" })).toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
  });
});
