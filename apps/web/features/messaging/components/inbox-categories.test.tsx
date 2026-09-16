import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { TooltipProvider } from "@/components/ui/tooltip";
import { server } from "@/test/msw/server";
import type { ListState } from "../lib";
import { InboxCategories, useCategoriesCollapsed } from "./inbox-categories";

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true, me: { id: "me" }, isLoading: false, isTechnician: false }),
}));

/** The unread half of the counters item — the red dot and the tooltip. */
const UNREAD = { unreadConversations: 4, flaggedConversations: 1, unreadByKind: { client: 3, unknown: 1 } };

/**
 * The totals half, as the reference screenshot has it: All 42657,
 * Requests 0, Clients 42423, Team 234, Archived 2.
 */
const TOTALS = {
  totalConversations: 42_657,
  totalByKind: { client: 42_423, team: 200, group: 34 },
  archivedConversations: 2,
  totalsRecountedAt: "2026-09-16T12:00:00.000Z",
};

function mockCounters(data: Record<string, unknown>) {
  server.use(
    http.get("*/messaging/conversations/counters", () => HttpResponse.json({ success: true, data })),
  );
}

/** `n` conversations on the list endpoint, for the "no totals yet" fallback. */
function mockConversations(n: number) {
  server.use(
    http.get("*/messaging/conversations", () =>
      HttpResponse.json({
        success: true,
        data: Array.from({ length: n }, (_, i) => ({
          id: `c${i}`,
          kind: "client",
          state: "open",
          unread: false,
          unreadCount: 0,
          flagged: false,
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z",
          lastMessageAt: "2026-09-01T00:00:00.000Z",
        })),
        pagination: { nextCursor: undefined, count: n },
      }),
    ),
  );
}

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  mockCounters({ ...UNREAD, ...TOTALS });
});

const states: ListState[] = [];

function Harness({ initial = { view: "all", search: "" } }: { initial?: ListState }) {
  const [state, setState] = useState<ListState>(initial);
  const [collapsed, toggle] = useCategoriesCollapsed();
  return (
    <InboxCategories
      state={state}
      onStateChange={(next) => {
        states.push(next);
        setState(next);
      }}
      collapsed={collapsed}
      onToggleCollapsed={toggle}
    />
  );
}

function renderCategories(initial?: ListState) {
  states.length = 0;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <Harness initial={initial} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("InboxCategories", () => {
  it("lists the Workiz categories in order, with TOTALS and a red dot where something is unread", async () => {
    renderCategories();

    expect(screen.getByRole("heading", { name: "Messages" })).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent?.replace(/[\d,+]+$/, ""))).toEqual(["All", "Requests", "Clients", "Team", "Archived"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");

    // The numbers are the size of each category, not the unread count.
    await waitFor(() => expect(screen.getByTestId("category-count-all")).toHaveTextContent("42,657"));
    // Requests really is empty, and a counted 0 is printed as 0.
    expect(screen.getByTestId("category-count-requests")).toHaveTextContent("0");
    expect(screen.getByTestId("category-count-clients")).toHaveTextContent("42,423");
    // Team folds the group threads in, as the category filter does: 200 + 34.
    expect(screen.getByTestId("category-count-team")).toHaveTextContent("234");
    expect(screen.getByTestId("category-count-archived")).toHaveTextContent("2");

    // The dot, and only the dot, carries "has unread".
    expect(within(screen.getByTestId("category-count-clients")).getByTestId("unread-dot")).toBeInTheDocument();
    expect(within(screen.getByTestId("category-count-team")).queryByTestId("unread-dot")).toBeNull();
    expect(within(screen.getByTestId("category-count-requests")).getByTestId("unread-dot")).toBeInTheDocument();
  });

  it("keeps the unread number in the tooltip", async () => {
    renderCategories();
    await waitFor(() => expect(screen.getByTestId("category-count-clients")).toHaveTextContent("42,423"));

    await userEvent.hover(screen.getByRole("tab", { name: /^Clients/ }));
    await waitFor(() =>
      expect(screen.getAllByText("Clients · 42,423 conversations · 3 unread").length).toBeGreaterThan(0),
    );
  });

  it("never prints a wrong 0: with no totals it falls back to the loaded rows with a +", async () => {
    // A counters item straight out of the import — unread numbers only, no
    // totals and no `totalsRecountedAt`. This is the dev bug: "All 0".
    mockCounters(UNREAD);
    mockConversations(42);
    renderCategories();

    // The open category shows what the list actually loaded, marked partial.
    await waitFor(() => expect(screen.getByTestId("category-count-all")).toHaveTextContent("42+"));
    // The others cannot be counted from here, so they print nothing at all
    // rather than a 0 that would be a lie.
    expect(screen.getByTestId("category-count-requests")).toHaveTextContent("");
    expect(screen.getByTestId("category-count-clients")).toHaveTextContent("");
    expect(screen.getByTestId("category-count-archived")).toHaveTextContent("");
    // The dots still work — they come from the unread half, which is real.
    expect(within(screen.getByTestId("category-count-clients")).getByTestId("unread-dot")).toBeInTheDocument();
  });

  it("selects a category into the list state — Team, Requests as unknown, Archived as its own view", async () => {
    renderCategories();

    await userEvent.click(screen.getByRole("tab", { name: "Team" }));
    expect(states.at(-1)).toMatchObject({ view: "all", kind: "team" });
    expect(screen.getByRole("tab", { name: /^Team/ })).toHaveAttribute("aria-selected", "true");

    await userEvent.click(screen.getByRole("tab", { name: /^Requests/ }));
    expect(states.at(-1)).toMatchObject({ view: "all", kind: "unknown" });

    await userEvent.click(screen.getByRole("tab", { name: /^Archived/ }));
    expect(states.at(-1)).toMatchObject({ view: "archived", kind: undefined });

    await userEvent.click(screen.getByRole("tab", { name: /^All/ }));
    expect(states.at(-1)).toMatchObject({ view: "all", kind: undefined });
  });

  it("keeps an Unread filter when switching category", async () => {
    renderCategories({ view: "unread", search: "" });
    await userEvent.click(screen.getByRole("tab", { name: /^Clients/ }));
    expect(states.at(-1)).toMatchObject({ view: "unread", kind: "client" });
  });

  it("folds to an icon rail and back, remembering the choice", async () => {
    renderCategories();
    await waitFor(() => expect(screen.getByTestId("category-count-clients")).toHaveTextContent("42,423"));

    await userEvent.click(screen.getByRole("button", { name: "Collapse categories" }));
    expect(screen.queryByRole("heading", { name: "Messages" })).toBeNull();
    const rail = screen.getByRole("navigation", { name: "Categories" });
    expect(rail).toHaveAttribute("data-collapsed", "true");
    const tabs = within(rail).getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-label"))).toEqual(["All", "Requests", "Clients", "Team", "Archived"]);
    // The dot survives the fold.
    expect(within(screen.getByRole("tab", { name: "Clients" })).getByTestId("unread-dot")).toBeInTheDocument();
    expect(window.localStorage.getItem("bitcrm.inbox.categories-collapsed")).toBe("1");

    await userEvent.click(screen.getByRole("tab", { name: "Team" }));
    expect(states.at(-1)).toMatchObject({ kind: "team" });

    await userEvent.click(screen.getByRole("button", { name: "Expand categories" }));
    expect(screen.getByRole("heading", { name: "Messages" })).toBeInTheDocument();
    expect(window.localStorage.getItem("bitcrm.inbox.categories-collapsed")).toBe("0");
  });
});
