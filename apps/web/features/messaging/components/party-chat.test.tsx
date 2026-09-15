import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { TooltipProvider } from "@/components/ui/tooltip";
import { server } from "@/test/msw/server";
import type { InboxConversation } from "../api";
import { PartyChat } from "./party-chat";
import { TextButton } from "./text-button";

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true, me: { id: "me" }, isLoading: false, isTechnician: false }),
}));
vi.mock("@/features/deals/hooks", () => ({
  useUserMap: () => ({ map: new Map(), users: [], isLoading: false }),
}));

const conversation: InboxConversation = {
  id: "c9",
  kind: "client",
  partyKind: "contact",
  partyId: "ct1",
  addresses: { phones: ["+14045551234"], emails: [] },
  state: "open",
  unread: false,
  unreadCount: 0,
  flagged: false,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-15T10:00:00.000Z",
};

let hasThread = false;
const sent: unknown[] = [];

beforeEach(() => {
  hasThread = false;
  sent.length = 0;
  server.use(
    http.get("*/messaging/conversations/text-lookup", () =>
      HttpResponse.json({
        success: true,
        data: { conversation: hasThread ? conversation : null, address: "+14045551234", optOut: null, canText: true },
      }),
    ),
    http.post("*/messaging/messages", async ({ request }) => {
      sent.push(await request.json());
      hasThread = true;
      return HttpResponse.json(
        {
          success: true,
          data: {
            id: "m1",
            conversationId: "c9",
            channel: "sms",
            direction: "outbound",
            body: "hello",
            status: "queued",
            origin: "user",
            createdAt: "2026-09-15T10:00:00.000Z",
            updatedAt: "2026-09-15T10:00:00.000Z",
          },
        },
        { status: 202 },
      );
    }),
    http.get("*/messaging/conversations/c9/messages", () =>
      HttpResponse.json({
        success: true,
        data: [
          {
            id: "m1",
            conversationId: "c9",
            channel: "sms",
            direction: "outbound",
            body: "hello",
            status: "sent",
            origin: "user",
            createdAt: "2026-09-15T10:00:00.000Z",
            updatedAt: "2026-09-15T10:00:00.000Z",
          },
        ],
        pagination: { count: 1 },
      }),
    ),
    http.get("*/messaging/conversations/c9", () => HttpResponse.json({ success: true, data: conversation })),
    http.post("*/messaging/conversations/c9/read", () =>
      HttpResponse.json({ success: true, data: conversation }),
    ),
    http.get("*/telephony/numbers", () => HttpResponse.json({ success: true, data: [] })),
  );
});

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("PartyChat", () => {
  it("starts a contact's thread with the first text, then shows the thread", async () => {
    wrap(<PartyChat partyKind="contact" partyId="ct1" dealId="d1" />);

    expect(await screen.findByText("No messages yet")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Message"), "hello{Enter}");

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ contactId: "ct1", dealId: "d1", body: "hello", channel: "sms" });
    // The lookup refetches into the new thread.
    expect(await screen.findByTestId("conversation-thread")).toBeInTheDocument();
    expect(await screen.findByText("hello")).toBeInTheDocument();
  });

  it("will not start a teammate's chat from here", async () => {
    wrap(<PartyChat partyKind="user" partyId="u1" />);
    expect(await screen.findByText(/team-chat milestone/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Message")).toBeNull();
  });
});

describe("TextButton", () => {
  it("opens the party's chat in a dialog", async () => {
    wrap(<TextButton partyKind="contact" partyId="ct1" name="Jane Doe" />);
    await userEvent.click(screen.getByRole("button", { name: "Text Jane Doe" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Text Jane Doe");
    expect(await screen.findByLabelText("Message")).toBeInTheDocument();
  });
});
