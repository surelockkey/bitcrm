import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import type { InboxConversation } from "../api";
import { ConversationList, type ListState } from "./conversation-list";

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({
    can: (r: string) => r === "messages",
    me: { id: "me" },
    isLoading: false,
    isTechnician: false,
  }),
}));

const conv = (id: string, extra: Partial<InboxConversation> = {}): InboxConversation => ({
  id,
  kind: "client",
  partyKind: "none",
  addresses: { phones: [], emails: [] },
  state: "open",
  unread: false,
  unreadCount: 0,
  flagged: false,
  lastMessageAt: "2026-09-15T10:00:00.000Z",
  lastMessagePreview: `preview ${id}`,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-15T10:00:00.000Z",
  ...extra,
});

const requestedViews: string[] = [];

beforeEach(() => {
  requestedViews.length = 0;
  server.use(
    http.get("*/messaging/conversations", ({ request }) => {
      const url = new URL(request.url);
      requestedViews.push(url.searchParams.get("view") ?? "");
      const data =
        url.searchParams.get("view") === "unread"
          ? [conv("b", { workizName: "Bob Builder", unread: true, unreadCount: 2 })]
          : [
              conv("a", { workizName: "Alice Adams" }),
              conv("b", { workizName: "Bob Builder", unread: true, unreadCount: 2, flagged: true }),
              conv("u", { kind: "unknown", addresses: { phones: ["+14045551234"], emails: [] } }),
            ];
      return HttpResponse.json({
        success: true,
        data,
        pagination: { nextCursor: url.searchParams.get("cursor") ? undefined : "more", count: data.length },
      });
    }),
    http.get("*/messaging/conversations/counters", () =>
      HttpResponse.json({
        success: true,
        data: { unreadConversations: 4, flaggedConversations: 1, unreadByKind: { client: 3, unknown: 1 } },
      }),
    ),
    http.get("*/messaging/conversations/by-address", () =>
      HttpResponse.json({
        success: true,
        data: conv("far", { kind: "unknown", addresses: { phones: ["+17705550000"], emails: [] } }),
      }),
    ),
    http.get("*/crm/companies", () =>
      HttpResponse.json({ success: true, data: [], pagination: { count: 0 } }),
    ),
  );
});

function Harness({ onSelect = () => {} }: { onSelect?: (id: string) => void }) {
  const [state, setState] = useState<ListState>({ view: "all", search: "" });
  return (
    <ConversationList state={state} onStateChange={setState} selectedId="a" onSelect={onSelect} />
  );
}

function renderList(onSelect?: (id: string) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness onSelect={onSelect} />
    </QueryClientProvider>,
  );
}

describe("ConversationList", () => {
  it("lists threads with names, numbers, unread badges and tab counts", async () => {
    renderList();

    expect(await screen.findByText("Alice Adams")).toBeInTheDocument();
    expect(screen.getByText("Bob Builder")).toBeInTheDocument();
    // An unknown number is shown as its number.
    expect(screen.getByText("(404) 555-1234")).toBeInTheDocument();
    expect(screen.getByLabelText("2 unread")).toHaveTextContent("2");
    expect(screen.getByText("Bob Builder").closest("button")).toHaveAttribute("data-unread", "true");
    // Counters feed the tab badges.
    const unreadTab = screen.getByRole("tab", { name: /Unread/ });
    expect(unreadTab).toHaveTextContent("4");
    expect(screen.getByRole("tab", { name: /Flagged/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
  });

  it("switches tabs by asking the server for that view", async () => {
    renderList();
    await screen.findByText("Alice Adams");

    await userEvent.click(screen.getByRole("tab", { name: /Unread/ }));

    await waitFor(() => expect(requestedViews).toContain("unread"));
    await waitFor(() => expect(screen.queryByText("Alice Adams")).toBeNull());
    expect(screen.getByText("Bob Builder")).toBeInTheDocument();
  });

  it("filters what is loaded as you type, by name or preview", async () => {
    renderList();
    await screen.findByText("Alice Adams");

    await userEvent.type(screen.getByLabelText("Search conversations"), "bob");
    await waitFor(() => expect(screen.queryByText("Alice Adams")).toBeNull());
    expect(screen.getByText("Bob Builder")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Search conversations"));
    await userEvent.type(screen.getByLabelText("Search conversations"), "preview a");
    await waitFor(() => expect(screen.queryByText("Bob Builder")).toBeNull());
    expect(screen.getByText("Alice Adams")).toBeInTheDocument();
  });

  it("looks a typed phone number up on the server and surfaces its thread", async () => {
    renderList();
    await screen.findByText("Alice Adams");

    await userEvent.type(screen.getByLabelText("Search conversations"), "770 555 0000");
    expect(await screen.findByText("(770) 555-0000")).toBeInTheDocument();
  });

  it("reports the picked thread", async () => {
    const onSelect = vi.fn();
    renderList(onSelect);
    await userEvent.click(await screen.findByText("Bob Builder"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });
});
