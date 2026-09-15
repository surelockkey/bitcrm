import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { TooltipProvider } from "@/components/ui/tooltip";
import { server } from "@/test/msw/server";
import type { FeedMessage, InboxConversation } from "../api";
import { ConversationThread } from "./conversation-thread";

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({
    can: () => true,
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
];

const readCalls: unknown[] = [];
let optedOut = false;

beforeEach(() => {
  readCalls.length = 0;
  optedOut = false;
  server.use(
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
      HttpResponse.json({ success: true, data: messages, pagination: { count: 2 } }),
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

  it("exposes manage actions on the header", async () => {
    renderThread();
    expect(await screen.findByRole("button", { name: "Star conversation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More actions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Assign/ })).toBeInTheDocument();
  });
});
