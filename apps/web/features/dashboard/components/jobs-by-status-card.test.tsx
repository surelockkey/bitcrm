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
const seenRanges: number[] = [];

const grants: Record<string, boolean> = { "roles.edit": true };
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({
    can: (resource: string, action: string) => grants[`${resource}.${action}`] ?? false,
  }),
}));

vi.mock("../hooks", () => ({
  useJobsByStatus: (range: number) => {
    seenRanges.push(range);
    return state;
  },
}));

beforeEach(() => {
  seenRanges.length = 0;
  state.refetch.mockClear();
});

/**
 * Картка «Jobs By Status»: рамка віджета, легенда трьох станів і власний
 * селектор періоду — те, що видно на скриншоті Workiz.
 */
describe("JobsByStatusCard", () => {
  it("names itself and says when the numbers came in", () => {
    renderWithClient(<JobsByStatusCard />);
    expect(screen.getByRole("heading", { name: "Jobs By Status" })).toBeInTheDocument();
    expect(screen.getByText(/^updated /)).toBeInTheDocument();
  });

  it("names all three states in the legend", () => {
    renderWithClient(<JobsByStatusCard />);
    const legend = screen.getByRole("list", { name: "Legend" });
    for (const label of ["Canceled", "Open", "Done"]) {
      expect(within(legend).getByText(label)).toBeInTheDocument();
    }
  });

  it("draws a column per state per day", () => {
    renderWithClient(<JobsByStatusCard />);
    expect(screen.getAllByTestId("daily-bar")).toHaveLength(6);
  });

  // За замовчуванням — останні тридцять днів, як і в решти віджетів.
  it("opens on the last thirty days", () => {
    renderWithClient(<JobsByStatusCard />);
    expect(seenRanges[0]).toBe(30);
  });

  it("asks for another window when the reader picks one", () => {
    renderWithClient(<JobsByStatusCard />);
    fireEvent.click(screen.getByRole("combobox", { name: "Range" }));
    fireEvent.click(screen.getByRole("option", { name: "Last 7 Days" }));
    expect(seenRanges.at(-1)).toBe(7);
  });

  it("refetches on the refresh button", () => {
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

/**
 * Три крапки: «хто бачить цей віджет». Пропонувати це тому, хто не редагує
 * ролі, — значить вести його в діалог, який сервер відхилить на збереженні.
 */
describe("JobsByStatusCard — the kebab", () => {
  it("offers managing permissions to somebody who edits roles", async () => {
    const user = userEvent.setup();
    renderWithClient(<JobsByStatusCard />);
    await user.click(screen.getByRole("button", { name: "Jobs By Status options" }));
    expect(
      await screen.findByRole("menuitem", { name: "Manage permissions" }),
    ).toBeInTheDocument();
  });

  it("does not offer it to anyone else", () => {
    grants["roles.edit"] = false;
    renderWithClient(<JobsByStatusCard />);
    expect(screen.getByRole("button", { name: "Jobs By Status options" })).toBeDisabled();
    grants["roles.edit"] = true;
  });
});
