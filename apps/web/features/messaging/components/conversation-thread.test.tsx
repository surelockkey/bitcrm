import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { TooltipProvider } from "@/components/ui/tooltip";
import { server } from "@/test/msw/server";
import type { FeedMessage, InboxConversation } from "../api";
import { ConversationThread } from "./conversation-thread";

const perms = vi.hoisted(() => ({ canSend: true }));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({
    can: (resource: string, action?: string) =>
      resource === "messages" && action === "send" ? perms.canSend : true,
    me: { id: "me" },
    isLoading: false,
    isTechnician: false,
  }),
}));
vi.mock("@/features/deals/hooks", () => ({
  useUserMap: () => ({ map: new Map(), users: [], isLoading: false }),
}));

const conversation: InboxConversation = {
  id: "c1",
  kind: "client",
  partyKind: "contact",
  partyId: "ct1",
  addresses: { phones: ["+14045551234"], emails: [] },
  state: "open",
  unread: true,
  unreadCount: 1,
  flagged: false,
  lastMessageAt: "2026-09-15T10:00:00.000Z",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-15T10:00:00.000Z",
};

const messages: FeedMessage[] = [
  {
    id: "m2",
    conversationId: "c1",
    channel: "sms",
    direction: "inbound",
    body: "Running late, sorry",
    status: "received",
    origin: "contact",
    createdAt: "2026-09-15T10:00:00.000Z",
    updatedAt: "2026-09-15T10:00:00.000Z",
  },
  {
    id: "m1",
    conversationId: "c1",
    channel: "sms",
    direction: "outbound",
    body: "Your tech is on the way",
    status: "delivered",
    origin: "user",
    createdAt: "2026-09-15T09:00:00.000Z",
    updatedAt: "2026-09-15T09:00:00.000Z",
  },
  {
    id: "m0",
    conversationId: "c1",
    channel: "sms",
    direction: "outbound",
    body: "Are you home?",
    status: "failed",
    errorCode: "21408",
    errorMessage: "Permission to send an SMS has not been enabled for the region",
    origin: "user",
    createdAt: "2026-09-15T08:00:00.000Z",
    updatedAt: "2026-09-15T08:00:00.000Z",
  },
];

const readCalls: unknown[] = [];
const resendCalls: unknown[] = [];
let optedOut = false;

beforeEach(() => {
  readCalls.length = 0;
  resendCalls.length = 0;
  optedOut = false;
  perms.canSend = true;
  server.use(
    http.post("*/messaging/conversations/c1/messages/m0/resend", async ({ request }) => {
      resendCalls.push(await request.json());
      return HttpResponse.json(
        {
          success: true,
          data: {
            ...messages[2],
            id: "m3",
            status: "queued",
            errorCode: undefined,
            errorMessage: undefined,
            resentFromMessageId: "m0",
            createdAt: "2026-09-15T10:30:00.000Z",
            updatedAt: "2026-09-15T10:30:00.000Z",
          },
        },
        { status: 202 },
      );
    }),
    http.get("*/messaging/conversations/text-lookup", () =>
      HttpResponse.json({
        success: true,
        data: {
          conversation,
          address: "+14045551234",
          optOut: optedOut
            ? { channel: "sms", address: "+14045551234", status: "opted_out", source: "advanced_opt_out", updatedAt: "x", history: [] }
            : null,
          canText: !optedOut,
        },
      }),
    ),
    http.get("*/messaging/conversations/c1/messages", () =>
      HttpResponse.json({ success: true, data: messages, pagination: { count: messages.length } }),
    ),
    http.get("*/messaging/conversations/c1", () =>
      HttpResponse.json({ success: true, data: conversation }),
    ),
    http.post("*/messaging/conversations/c1/read", async ({ request }) => {
      readCalls.push(await request.json());
      return HttpResponse.json({ success: true, data: { ...conversation, unread: false, unreadCount: 0 } });
    }),
    http.get("*/messaging/counters", () =>
      HttpResponse.json({ success: true, data: { unreadConversations: 0, flaggedConversations: 0, unreadByKind: {} } }),
    ),
    http.get("*/messaging/conversations/counters", () =>
      HttpResponse.json({ success: true, data: { unreadConversations: 0, flaggedConversations: 0, unreadByKind: {} } }),
    ),
  );
});

function renderThread() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ConversationThread
          conversationId="c1"
          title="Jane Doe"
          footer={({ optedOut: blocked }) => <div data-testid="footer">{blocked ? "blocked" : "open"}</div>}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("ConversationThread", () => {
  it("renders the header and feed, then marks the thread read up to the newest line", async () => {
    renderThread();

    expect(await screen.findByRole("heading", { name: "Jane Doe" })).toBeInTheDocument();
    expect(await screen.findByText("Running late, sorry")).toBeInTheDocument();
    expect(screen.getByText("Your tech is on the way")).toBeInTheDocument();

    await waitFor(() => expect(readCalls).toHaveLength(1));
    expect(readCalls[0]).toEqual({ lastReadMessageSk: "MSG#2026-09-15T10:00:00.000Z#m2" });
    // Marked once — the marker now matches the newest line.
    await waitFor(() => expect(screen.getByTestId("footer")).toHaveTextContent("open"));
    expect(readCalls).toHaveLength(1);
  });

  it("shows the opt-out banner and tells the footer sending is blocked", async () => {
    optedOut = true;
    renderThread();

    expect(await screen.findByText("This number opted out of texts")).toBeInTheDocument();
    expect(screen.getByTestId("footer")).toHaveTextContent("blocked");
  });

  it("has the Workiz header: name with the type under it, person and phone icons, and ⋮ for the rest", async () => {
    renderThread();
    expect(await screen.findByRole("heading", { name: "Jane Doe" })).toBeInTheDocument();
    expect(screen.getByText("Client")).toBeInTheDocument();
    // Without a side sheet to open (embedded use), the person icon goes to the record itself.
    expect(screen.getByRole("link", { name: "Contact card" })).toHaveAttribute("href", "/contacts/ct1");
    expect(screen.getByRole("button", { name: "Call (404) 555-1234" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(await screen.findByRole("menuitem", { name: /Assign to/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Star" })).toBeInTheDocument();
    // Opening the thread marked it read, so the item now offers the reverse.
    expect(screen.getByRole("menuitem", { name: "Mark as unread" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Archive" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Open record/ })).toHaveAttribute("href", "/contacts/ct1");
  });

  it("names the client on incoming bubbles and shows the recap chip", async () => {
    renderThread();
    const incoming = (await screen.findByText("Running late, sorry")).closest("[data-direction]") as HTMLElement;
    expect(incoming).toHaveTextContent("Jane Doe");
    expect(screen.getByRole("button", { name: "Recap conversation" })).toBeInTheDocument();
  });

  it("draws the failed line in the Workiz way and resends it through the resend route", async () => {
    renderThread();

    const bubble = (await screen.findByText("Are you home?")).closest("[data-direction]") as HTMLElement;
    expect(bubble).toHaveTextContent("Failed · Permission to send an SMS has not been enabled for the region");
    expect(bubble.querySelector("[data-tick]")).toHaveAttribute("data-tick", "error");

    await userEvent.click(screen.getByRole("button", { name: "Resend" }));

    await waitFor(() => expect(resendCalls).toHaveLength(1));
    expect(resendCalls[0]).toEqual({ clientMessageId: expect.stringMatching(/^[0-9a-f-]{36}$/) });

    // The new line lands in the feed once, the original says it was resent.
    await waitFor(() => expect(screen.getAllByText("Are you home?")).toHaveLength(2));
    expect(screen.getByTestId("message-feed").querySelector('[data-message-id="m3"]')).toBeInTheDocument();
    expect(bubble).toHaveTextContent("· Resent");
    expect(screen.queryByRole("button", { name: "Resend" })).toBeNull();
  });

  it("keeps the reason but hides Resend from a viewer without messages.send", async () => {
    perms.canSend = false;
    renderThread();

    const bubble = (await screen.findByText("Are you home?")).closest("[data-direction]") as HTMLElement;
    expect(bubble).toHaveTextContent("Failed · Permission to send an SMS");
    expect(screen.queryByRole("button", { name: "Resend" })).toBeNull();
  });
});
