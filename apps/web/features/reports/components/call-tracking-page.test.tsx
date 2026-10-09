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
    avgDurationSeconds: 94.5,
    conversion: 31.68,
    revenue: 289484.03,
  },
  graph: {
    graphBy: "hour",
    buckets: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")),
    series: [
      { name: "(2-CT-O) SURE CT ORGANIC", counts: Array.from({ length: 24 }, (_, h) => (h >= 8 && h < 20 ? 3 : 0)) },
      { name: "(1-IL-O) SURE IL CTM", counts: Array.from({ length: 24 }, (_, h) => (h === 9 ? 1 : 0)) },
    ],
  },
  atLeast: false,
  computedAt: "2026-09-29T19:00:00.000Z",
  ...over,
});

const empty = (): CallTrackingReport =>
  report({
    rows: [],
    cards: { incomingCalls: 0, callers: 0, missedCalls: 0, topFlow: null, avgDurationSeconds: 0, conversion: 0, revenue: 0 },
    graph: { graphBy: "hour", buckets: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")), series: [] },
  });

const card = (caption: string) => within(screen.getByRole("group", { name: "Report totals" })).getByRole("group", { name: caption });
const table = () => screen.getByRole("table", { name: "Call Tracking" });
const records = () => within(table()).getAllByRole("row").filter((r) => !r.hasAttribute("aria-hidden")).slice(1);

beforeEach(() => {
  perms.granted = new Set(["reports.view", "calls.view", "financials.view"]);
  useCallTracking.mockReset();
  useCallTracking.mockImplementation(() => ({ data: report(), isPlaceholderData: false }));
});

describe("CallTrackingPage — Workiz's Call Tracking", () => {
  it("opens on This month, by call flow, hour by hour, with no title of its own — as Workiz does", () => {
    render(<CallTrackingPage today="2026-09-29" />);
    expect(useCallTracking).toHaveBeenLastCalledWith(
      { from: "2026-09-01", to: "2026-09-29", groupBy: "flows", graphBy: "hour" },
      true,
    );
    expect(screen.queryByRole("heading", { name: "Call Tracking" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Group by" })).toBeInTheDocument();
    expect(screen.getByText("By Call Flow")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Date range: This month, Sep 1st, 2026 - Sep 29th, 2026" })).toBeInTheDocument();
  });

  it("shows Workiz's seven cards, printed as Workiz prints them", () => {
    render(<CallTrackingPage today="2026-09-29" />);
    for (const [caption, value] of [
      ["Incoming calls", "10536"],
      ["Callers", "6604"],
      ["Missed calls", "1469"],
      ["Top Flow", "(2-CT-O) SURE CT ORGANIC"],
      ["Avg Duration", "1 Min 35 Sec"],
      ["Conversion", "31.68%"],
      ["Revenue", "$289484.03"],
    ]) {
      expect(card(caption)).toHaveTextContent(value);
    }
  });

  it("draws the calls per flow with the hour step chosen and a legend of the flows by name", () => {
    render(<CallTrackingPage today="2026-09-29" />);
    expect(screen.getByRole("radio", { name: "hour" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("img", { name: "Calls per call flow" })).toBeInTheDocument();
    const legend = screen.getByRole("list", { name: "Calls per call flow legend" });
    expect(within(legend).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "(1-IL-O) SURE IL CTM",
      "(2-CT-O) SURE CT ORGANIC",
    ]);
  });

  it("lists twenty rows a page in Workiz's cells, with its pager inside the frame", async () => {
    render(<CallTrackingPage today="2026-09-29" />);
    expect(records()).toHaveLength(20);
    expect(records()[0]).toHaveTextContent("(2-CT-O) SURE CT ORGANIC");
    expect(records()[0]).toHaveTextContent("WORKIZ ACCOUNT NUMBER ALL");
    expect(records()[0]).toHaveTextContent("2 min 26 sec");
    expect(records()[0]).toHaveTextContent("11.9%");
    expect(records()[0]).toHaveTextContent("$6245.47");
    expect(screen.getByText("Showing 1 to 20 of 25 results")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Showing 21 to 25 of 25 results")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  });

  it("sorts in the browser, ascending first, then descending — react-table's click", async () => {
    render(<CallTrackingPage today="2026-09-29" />);
    await userEvent.click(screen.getByRole("button", { name: "Sort by Callers" }));
    expect(records()[0]).toHaveTextContent("Flow 24");
    expect(screen.getByRole("columnheader", { name: /Callers/ })).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(screen.getByRole("button", { name: "Sort by Callers" }));
    expect(records()[0]).toHaveTextContent("(2-CT-O) SURE CT ORGANIC");
    expect(screen.getByRole("columnheader", { name: /Callers/ })).toHaveAttribute("aria-sort", "descending");
  });

  it("switches to the number view and another graph step", async () => {
    render(<CallTrackingPage today="2026-09-29" />);
    await userEvent.click(screen.getByRole("combobox", { name: "Group by" }));
    await userEvent.click(screen.getByRole("option", { name: "By Phone Number" }));
    await userEvent.click(screen.getByRole("radio", { name: "day" }));
    expect(useCallTracking).toHaveBeenLastCalledWith(
      { from: "2026-09-01", to: "2026-09-29", groupBy: "numbers", graphBy: "day" },
      true,
    );
  });

  it("takes another preset from Workiz's list", async () => {
    render(<CallTrackingPage today="2026-09-29" />);
    await userEvent.click(screen.getByRole("button", { name: /Date range/ }));
    const presets = within(screen.getByRole("listbox", { name: "Date presets" })).getAllByRole("option");
    expect(presets.map((p) => p.textContent)).toEqual([
      "Custom", "Today", "Yesterday", "Last 7 days", "Last 14 days", "Last 30 days", "Last month", "This month",
      "This year", "Last year", "This week (Sun-Today)", "This week (Mon-Today)", "Last week (Sun-Sat)",
      "Last week (Mon-Sun)", "Last business week (Mon-Fri)", "Recent (30 days, including today)",
    ]);
    await userEvent.click(screen.getByRole("option", { name: "Last week (Mon-Sun)" }));
    expect(useCallTracking).toHaveBeenLastCalledWith(expect.objectContaining({ from: "2026-09-21", to: "2026-09-27" }), true);
  });

  it("counts Last 7 days up to and including the viewer's today", async () => {
    render(<CallTrackingPage today="2026-10-08" />);
    await userEvent.click(screen.getByRole("button", { name: /Date range/ }));
    await userEvent.click(screen.getByRole("option", { name: "Last 7 days" }));
    expect(useCallTracking).toHaveBeenLastCalledWith(expect.objectContaining({ from: "2026-10-02", to: "2026-10-08" }), true);
  });

  it("over a period without calls: zero cards, no graph, ten silent blank rows", () => {
    useCallTracking.mockImplementation(() => ({ data: empty(), isPlaceholderData: false }));
    render(<CallTrackingPage today="2026-09-29" />);
    expect(card("Top Flow")).toHaveTextContent("N/A");
    expect(card("Avg Duration")).toHaveTextContent("0 Sec");
    expect(card("Conversion")).toHaveTextContent("0%");
    expect(card("Revenue")).toHaveTextContent("$0.00");
    expect(screen.queryByRole("radiogroup", { name: "Graph step" })).toBeNull();
    expect(screen.queryByRole("img", { name: "Calls per call flow" })).toBeNull();
    expect(screen.queryByText("No Records Found")).toBeNull();
    expect(screen.getByText("Showing 1 to 0 of 0 results")).toBeInTheDocument();
  });

  it("leaves money out without financials", () => {
    perms.granted.delete("financials.view");
    useCallTracking.mockImplementation(() => ({
      data: report({ cards: { ...report().cards, revenue: undefined }, rows: [row(1, { revenue: undefined })] }),
      isPlaceholderData: false,
    }));
    render(<CallTrackingPage today="2026-09-29" />);
    expect(within(screen.getByRole("group", { name: "Report totals" })).queryByText("Revenue")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: /Revenue/ })).toBeNull();
  });

  it("refuses a role without calls.view, as Workiz's Call Reports restriction does", () => {
    perms.granted.delete("calls.view");
    render(<CallTrackingPage today="2026-09-29" />);
    expect(screen.getByText(/no access/i)).toBeInTheDocument();
    expect(useCallTracking).toHaveBeenLastCalledWith(expect.anything(), false);
  });
});
