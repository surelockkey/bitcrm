import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { TooltipProvider } from "@/components/ui/tooltip";
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
const requestedKinds: string[] = [];
const patches: { id: string; body: unknown }[] = [];

beforeEach(() => {
  requestedViews.length = 0;
  requestedKinds.length = 0;
  patches.length = 0;
  server.use(
    http.get("*/messaging/conversations", ({ request }) => {
      const url = new URL(request.url);
      requestedViews.push(url.searchParams.get("view") ?? "");
      requestedKinds.push(url.searchParams.get("kind") ?? "");
      const data =
        url.searchParams.get("view") === "unread"
          ? [conv("b", { workizName: "Bob Builder", unread: true, unreadCount: 2 })]
          : url.searchParams.get("kind") === "group"
            ? [conv("g", { kind: "group", partyKind: "group", partyId: "grp", workizName: "Night crew" })]
            : [
                conv("a", { workizName: "Alice Adams" }),
                conv("b", { workizName: "Bob Builder", unread: true, unreadCount: 2, flagged: true }),
                conv("u", { kind: "unknown", addresses: { phones: ["+14045551234"], emails: [] } }),
                conv("t", { kind: "team", partyKind: "user", partyId: "u1", workizName: "(2) TX - Cannon Burt" }),
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
    http.patch("*/messaging/conversations/:id", async ({ params, request }) => {
      const body = await request.json();
      patches.push({ id: String(params.id), body });
      return HttpResponse.json({ success: true, data: conv(String(params.id), body as Partial<InboxConversation>) });
    }),
    http.get("*/crm/companies", () =>
      HttpResponse.json({ success: true, data: [], pagination: { count: 0 } }),
    ),
  );
});

function Harness({
  onSelect = () => {},
  onNewConversation,
  initial = { view: "all", search: "" },
}: {
  onSelect?: (id: string) => void;
  onNewConversation?: () => void;
  initial?: ListState;
}) {
  const [state, setState] = useState<ListState>(initial);
  return (
    <ConversationList
      state={state}
      onStateChange={setState}
      selectedId="a"
      onSelect={onSelect}
      onNewConversation={onNewConversation}
    />
  );
}

function renderList(props: { onSelect?: (id: string) => void; onNewConversation?: () => void; initial?: ListState } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <Harness {...props} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const row = (name: string) => screen.getByText(name).closest("[data-conversation-row]") as HTMLElement;

describe("ConversationList", () => {
  it("lists threads Workiz-style: initial avatar, bold name with a type tag, snippet, time, unread dot", async () => {
    renderList();

    expect(await screen.findByText("Alice Adams")).toBeInTheDocument();
    expect(screen.getByText("Bob Builder")).toBeInTheDocument();
    // An unknown number is shown as its number, tagged (Unknown); a technician is (Tech).
    expect(screen.getByText("(404) 555-1234")).toBeInTheDocument();
    expect(within(row("(404) 555-1234")).getByText("(Unknown)")).toBeInTheDocument();
    expect(within(row("Alice Adams")).getByText("(Client)")).toBeInTheDocument();
    expect(within(row("(2) TX - Cannon Burt")).getByText("(Tech)")).toBeInTheDocument();
    // The avatar carries the first character, verbatim.
    expect(within(row("(2) TX - Cannon Burt")).getByText("(", { selector: "[data-slot=avatar-fallback]" })).toBeInTheDocument();
    expect(within(row("Alice Adams")).getByText("preview a")).toBeInTheDocument();

    expect(screen.getByLabelText("2 unread")).toBeInTheDocument();
    expect(row("Bob Builder")).toHaveAttribute("data-unread", "true");
    // The open thread is marked; here the harness has "a" selected.
    expect(row("Alice Adams")).toHaveAttribute("aria-current", "true");
    expect(row("Bob Builder")).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
  });

  it("filters with the funnel — Unread asks the server, with the counts in the menu", async () => {
    renderList();
    await screen.findByText("Alice Adams");

    await userEvent.click(screen.getByRole("button", { name: "Filter" }));
    const unread = await screen.findByRole("menuitemradio", { name: /^Unread/ });
    expect(unread).toHaveTextContent("4");
    expect(screen.getByRole("menuitemradio", { name: /^Flagged/ })).toHaveTextContent("1");
    await userEvent.click(unread);

    await waitFor(() => expect(requestedViews).toContain("unread"));
    await waitFor(() => expect(screen.queryByText("Alice Adams")).toBeNull());
    expect(screen.getByText("Bob Builder")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter: Unread" })).toBeInTheDocument();
  });

  it("asks the server for the category picked in the left column; Archived is its own view", async () => {
    renderList({ initial: { view: "all", kind: "client", search: "" } });
    await waitFor(() => expect(requestedKinds).toContain("client"));

    renderList({ initial: { view: "archived", search: "" } });
    await waitFor(() => expect(requestedViews).toContain("archived"));
  });

  it("narrows a filter view by category on the client, since the server cannot combine them", async () => {
    renderList({ initial: { view: "unread", kind: "unknown", search: "" } });
    await waitFor(() => expect(requestedViews).toContain("unread"));
    // The unread page holds only Bob (a client); Requests = unknown shows nothing.
    await waitFor(() => expect(screen.getByText("No conversations yet")).toBeInTheDocument());
    expect(screen.getByText(/Nothing in Requests · Unread/)).toBeInTheDocument();
    expect(screen.queryByText("Bob Builder")).toBeNull();
  });

  it("offers the New message icon to senders", async () => {
    const onNew = vi.fn();
    renderList({ onNewConversation: onNew });
    await userEvent.click(await screen.findByRole("button", { name: "New message" }));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("lists team groups behind the group icon and opens one", async () => {
    const onSelect = vi.fn();
    renderList({ onSelect });
    await screen.findByText("Alice Adams");

    await userEvent.click(screen.getByRole("button", { name: "Groups" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Night crew/ }));
    await waitFor(() => expect(requestedKinds).toContain("group"));
    expect(onSelect).toHaveBeenCalledWith("g");
  });

  it("unfolds the search icon into a field that filters what is loaded, by name or preview", async () => {
    renderList();
    await screen.findByText("Alice Adams");
    expect(screen.queryByLabelText("Search conversations")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await userEvent.type(screen.getByLabelText("Search conversations"), "bob");
    await waitFor(() => expect(screen.queryByText("Alice Adams")).toBeNull());
    expect(screen.getByText("Bob Builder")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Search conversations"));
    await userEvent.type(screen.getByLabelText("Search conversations"), "preview a");
    await waitFor(() => expect(screen.queryByText("Bob Builder")).toBeNull());
    expect(screen.getByText("Alice Adams")).toBeInTheDocument();

    // Closing the field clears the search and brings the toolbar back.
    await userEvent.click(screen.getByRole("button", { name: "Close search" }));
    expect(await screen.findByText("Bob Builder")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
  });

  it("looks a typed phone number up on the server and surfaces its thread", async () => {
    renderList();
    await screen.findByText("Alice Adams");

    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await userEvent.type(screen.getByLabelText("Search conversations"), "770 555 0000");
    expect(await screen.findByText("(770) 555-0000")).toBeInTheDocument();
  });

  it("reports the picked thread", async () => {
    const onSelect = vi.fn();
    renderList({ onSelect });
    await userEvent.click(await screen.findByText("Bob Builder"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("has a ⋮ menu per row with read / star / archive, which does not open the thread", async () => {
    const onSelect = vi.fn();
    renderList({ onSelect });
    await screen.findByText("Bob Builder");

    await userEvent.click(screen.getByRole("button", { name: "More actions for Bob Builder" }));
    expect(await screen.findByRole("menuitem", { name: "Mark as read" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Unstar" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "Archive" }));

    await waitFor(() => expect(patches).toEqual([{ id: "b", body: { state: "archived" } }]));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
