import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CallTrackingReport, CallTrackingRow } from "@bitcrm/types";
import { CallTrackingPage } from "./call-tracking-page";

const perms = vi.hoisted(() => ({ granted: new Set<string>() }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => (resource: string, action = "view") => !perms.granted.has(`${resource}.${action}`),
  usePermissions: () => ({
    can: (resource: string, action = "view") => perms.granted.has(`${resource}.${action}`),
    isLoading: false,
  }),
}));
vi.mock("@/features/job-sources/hooks", () => ({
  useJobSources: () => ({ data: [{ id: "src-all", name: "WORKIZ ACCOUNT NUMBER ALL" }] }),
}));

const useCallTracking = vi.hoisted(() => vi.fn());
vi.mock("../call-tracking/hooks", () => ({ useCallTracking }));

const row = (n: number, over: Partial<CallTrackingRow> = {}): CallTrackingRow => ({
  key: `f${n}`,
  name: `Flow ${n}`,
  adGroupId: "src-all",
  calls: 100 - n,
  callers: 50 - n,
  completed: 90 - n,
  missed: 10,
  avgDurationSeconds: 146,
  jobs: 5,
  leads: 0,
  jobsConversionRate: 11.9,
  leadsConversionRate: 0,
  revenue: 6245.47,
  ...over,
});

const report = (over: Partial<CallTrackingReport> = {}): CallTrackingReport => ({
  from: "2026-09-01",
  to: "2026-09-29",
  groupBy: "flows",
  graphBy: "hour",
  rows: Array.from({ length: 25 }, (_, i) => row(i, i === 0 ? { name: "(2-CT-O) SURE CT ORGANIC" } : {})),
  cards: {
    incomingCalls: 10536,
    callers: 6604,
    missedCalls: 1469,
    topFlow: "(2-CT-O) SURE CT ORGANIC",
    avgDurationSeconds: 95.4,
    conversion: 31.68,
    revenue: 289484.03,
  },
  graph: {
    graphBy: "hour",
    buckets: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")),
    series: [{ name: "(2-CT-O) SURE CT ORGANIC", counts: Array.from({ length: 24 }, () => 1) }],
  },
  atLeast: false,
  computedAt: "2026-09-29T19:00:00.000Z",
  ...over,
});

beforeEach(() => {
  perms.granted = new Set(["reports.view", "calls.view", "financials.view"]);
  useCallTracking.mockReset();
  useCallTracking.mockImplementation(() => ({ data: report(), isPlaceholderData: false }));
});

describe("CallTrackingPage", () => {
  it("opens on This month, by call flow, hour by hour — as Workiz does", () => {
    render(<CallTrackingPage today="2026-09-29" />);
    expect(useCallTracking).toHaveBeenLastCalledWith(
      { from: "2026-09-01", to: "2026-09-29", groupBy: "flows", graphBy: "hour" },
      true,
    );
    expect(screen.getByRole("combobox", { name: "Date preset" })).toHaveValue("this_month");
  });

  it("shows Workiz's seven cards", () => {
    render(<CallTrackingPage today="2026-09-29" />);
    const cards = within(screen.getByRole("group", { name: "Report totals" }));
    for (const [label, value] of [
      ["Incoming calls", "10,536"],
      ["Callers", "6,604"],
      ["Missed calls", "1,469"],
      ["Avg Duration", "1 Min 35 Sec"],
      ["Conversion", "31.68%"],
      ["Revenue", "$289,484.03"],
    ]) {
      expect(cards.getByText(label).previousSibling).toHaveTextContent(value);
    }
    expect(cards.getByText("Top Flow").previousSibling).toHaveTextContent("(2-CT-O) SURE CT ORGANIC");
  });

  it("pages the table twenty rows at a time", async () => {
    render(<CallTrackingPage today="2026-09-29" />);
    const table = screen.getByRole("table", { name: "Call Tracking" });
    expect(within(table).getAllByRole("row")).toHaveLength(21);
    expect(screen.getByText("Showing 1 to 20 of 25 results")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Showing 21 to 25 of 25 results")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  });

  it("sorts in the browser by a clicked column", async () => {
    render(<CallTrackingPage today="2026-09-29" />);
    await userEvent.click(screen.getByRole("button", { name: "Callers" }));
    await userEvent.click(screen.getByRole("button", { name: "Callers" }));
    const first = within(screen.getByRole("table", { name: "Call Tracking" })).getAllByRole("row")[1];
    // Ascending: the row with the fewest callers (Flow 24, 26 callers) first.
    expect(first).toHaveTextContent("Flow 24");
    expect(first).toHaveTextContent("2 min 26 sec");
    expect(first).toHaveTextContent("WORKIZ ACCOUNT NUMBER ALL");
  });

  it("switches to the number view and another graph step", async () => {
    render(<CallTrackingPage today="2026-09-29" />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Group by" }), "numbers");
    await userEvent.click(screen.getByRole("radio", { name: "day" }));
    expect(useCallTracking).toHaveBeenLastCalledWith(
      { from: "2026-09-01", to: "2026-09-29", groupBy: "numbers", graphBy: "day" },
      true,
    );
  });

  it("takes a custom period", async () => {
    render(<CallTrackingPage today="2026-09-29" />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Date preset" }), "last_week_mon");
    expect(useCallTracking).toHaveBeenLastCalledWith(expect.objectContaining({ from: "2026-09-21", to: "2026-09-27" }), true);
  });

  it("leaves money out without financials", () => {
    perms.granted.delete("financials.view");
    useCallTracking.mockImplementation(() => ({
      data: report({ cards: { ...report().cards, revenue: undefined }, rows: [row(1, { revenue: undefined })] }),
      isPlaceholderData: false,
    }));
    render(<CallTrackingPage today="2026-09-29" />);
    expect(within(screen.getByRole("group", { name: "Report totals" })).queryByText("Revenue")).toBeNull();
    expect(screen.queryByRole("button", { name: "Revenue" })).toBeNull();
  });

  it("refuses a role without calls.view, as Workiz's Call Reports restriction does", () => {
    perms.granted.delete("calls.view");
    render(<CallTrackingPage today="2026-09-29" />);
    expect(screen.getByText(/no access/i)).toBeInTheDocument();
    expect(useCallTracking).toHaveBeenLastCalledWith(expect.anything(), false);
  });
});
