import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithClient } from "@/test/render-with-client";
import { JobsByStatusCard } from "./jobs-by-status-card";

const state = {
  data: {
    days: [
      { day: "2026-09-27", open: 5, done: 15, canceled: 28 },
      { day: "2026-09-28", open: 287, done: 0, canceled: 0 },
    ],
    atLeast: false,
  } as unknown,
  isLoading: false,
  isError: false,
  isFetching: false,
  dataUpdatedAt: Date.parse("2026-09-28T07:08:00.000Z"),
  refetch: vi.fn(),
};
const seenWindows: { from: string; to: string }[] = [];

const grants: Record<string, boolean> = { "roles.edit": true };
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: (resource: string, action: string) => grants[`${resource}.${action}`] ?? false,
  }),
}));

vi.mock("../hooks", () => ({
  useJobsByStatus: (window: { from: string; to: string }) => {
    seenWindows.push(window);
    return state;
  },
}));

beforeEach(() => {
  seenWindows.length = 0;
  state.refetch.mockClear();
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-10-08T15:00:00Z") });
  return () => vi.useRealTimers();
});

/**
 * Картка «Jobs By Status» як у Workiz Home: «updated …», «?», легенда трьох
 * станів, «Last 14 Days ⌄» і стовпчики chart.js.
 */
describe("JobsByStatusCard", () => {
  it("names itself, says when the numbers were computed, and explains itself", () => {
    renderWithClient(<JobsByStatusCard />);
    expect(screen.getByRole("heading", { name: "Jobs By Status" })).toBeInTheDocument();
    expect(screen.getByText(/^updated /)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "About Jobs By Status" })).toBeInTheDocument();
  });

  it("names all three states in the legend", () => {
    renderWithClient(<JobsByStatusCard />);
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(within(legend).getAllByRole("listitem").map((i) => i.textContent)).toEqual(["Canceled", "Open", "Done"]);
  });

  it("draws a column per state per day", () => {
    renderWithClient(<JobsByStatusCard />);
    expect(document.querySelectorAll("[data-slot=wz-chart-bar]")).toHaveLength(6);
  });

  // Workiz opens every ranged widget on «Last 14 days» — fifteen days, both ends.
  it("opens on Workiz's last 14 days", () => {
    renderWithClient(<JobsByStatusCard />);
    expect(seenWindows[0]).toEqual({ from: "2026-09-24", to: "2026-10-08" });
    expect(screen.getByRole("button", { name: "Range: Last 14 days" })).toBeInTheDocument();
  });

  it("asks for another window when the reader picks one", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithClient(<JobsByStatusCard />);
    await user.click(screen.getByRole("button", { name: "Range: Last 14 days" }));
    await user.click(screen.getByRole("menuitemradio", { name: "This month" }));
    expect(seenWindows.at(-1)).toEqual({ from: "2026-10-01", to: "2026-10-08" });
  });

  it("refetches on the refresh arrows", () => {
    renderWithClient(<JobsByStatusCard />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh Jobs By Status" }));
    expect(state.refetch).toHaveBeenCalled();
  });

  it("keeps the same numbers as a table for screen readers", () => {
    renderWithClient(<JobsByStatusCard />);
    const table = screen.getByRole("table", { name: "Jobs by status" });
    expect(within(table).getByText("287")).toBeInTheDocument();
  });

  it("says so when the chart could not load", () => {
    state.isError = true;
    renderWithClient(<JobsByStatusCard />);
    expect(screen.getByText("Couldn't load this widget.")).toBeInTheDocument();
    state.isError = false;
  });
});
