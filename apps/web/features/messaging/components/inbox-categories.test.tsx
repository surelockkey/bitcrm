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

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  server.use(
    http.get("*/messaging/conversations/counters", () =>
      HttpResponse.json({
        success: true,
        data: { unreadConversations: 4, flaggedConversations: 1, unreadByKind: { client: 3, unknown: 1 } },
      }),
    ),
  );
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
  it("lists the Workiz categories in order, with counts and a red dot where something is unread", async () => {
    renderCategories();

    expect(screen.getByRole("heading", { name: "Messages" })).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent?.replace(/\d+$/, ""))).toEqual(["All", "Requests", "Clients", "Team", "Archived"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");

    await waitFor(() => expect(screen.getByTestId("category-count-all")).toHaveTextContent("4"));
    expect(screen.getByTestId("category-count-requests")).toHaveTextContent("1");
    expect(screen.getByTestId("category-count-clients")).toHaveTextContent("3");
    expect(screen.getByTestId("category-count-team")).toHaveTextContent("0");
    // Archived has no counter on the API.
    expect(screen.getByTestId("category-count-archived")).toHaveTextContent("");

    expect(within(screen.getByTestId("category-count-clients")).getByTestId("unread-dot")).toBeInTheDocument();
    expect(within(screen.getByTestId("category-count-team")).queryByTestId("unread-dot")).toBeNull();
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
    await waitFor(() => expect(screen.getByTestId("category-count-clients")).toHaveTextContent("3"));

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
