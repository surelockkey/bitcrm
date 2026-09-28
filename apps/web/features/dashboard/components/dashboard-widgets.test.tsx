import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithClient } from "@/test/render-with-client";
import {
  DispatchScoreboardCard,
  JobsNowCard,
  RecentCallsCard,
  SalesCard,
  ServiceAreasCard,
  TechScoreboardCard,
  TodayCard,
  TopCallFlowsCard,
  TopJobTypesCard,
  TopSourcesCard,
} from "./dashboard-widgets";

const grants: Record<string, boolean> = {};
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({
    can: (resource: string, action: string) => grants[`${resource}.${action}`] ?? false,
  }),
}));

const answers: Record<string, unknown> = {};
const seen: string[] = [];
const q = (data: unknown) => ({
  data,
  isLoading: false,
  isError: false,
  isFetching: false,
  dataUpdatedAt: Date.parse("2026-09-28T07:08:00.000Z"),
  refetch: vi.fn(),
});

vi.mock("../hooks", () => ({
  useRangeWidget: (name: string) => {
    seen.push(name);
    return q(answers[name]);
  },
  useToday: () => q(answers.today),
  useJobsNow: () => q(answers["jobs-now"]),
  useRecentCalls: () => q(answers["recent-calls"]),
}));

beforeEach(() => {
  seen.length = 0;
  for (const k of Object.keys(answers)) delete answers[k];
});

const shares = {
  slices: [
    { key: "s1", name: "SURE TX PLATINUM", count: 46, percent: 30.46 },
    { key: "s2", name: "MOBILE CT LOCKSMITH", count: 45, percent: 29.8 },
    { key: "s3", name: "SURE CT NEW HAVEN", count: 30, percent: 19.87 },
    { key: "s4", name: "SURE CT GOOGLE ADS", count: 30, percent: 19.87 },
  ],
};

/**
 * Пироги: чотири частки, легенда з назвою й відсотком під кожною — як у
 * Workiz. Колір тут не єдиний носій ідентичності: назва стоїть поруч.
 */
describe("the pies — Top Sources, Top Job Types, Service Areas", () => {
  it.each([
    [TopSourcesCard, "Top Sources", "top-sources"],
    [TopJobTypesCard, "Top Job Types", "top-job-types"],
    [ServiceAreasCard, "Service Areas", "service-areas"],
  ])("%o reads its own widget and titles itself", (Card, title, name) => {
    answers[name] = shares;
    renderWithClient(<Card />);
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(seen).toContain(name);
  });

  it("names every slice with its percent", () => {
    answers["top-sources"] = shares;
    renderWithClient(<TopSourcesCard />);
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(within(legend).getByText("SURE TX PLATINUM")).toBeInTheDocument();
    expect(within(legend).getByText("30.46%")).toBeInTheDocument();
    expect(within(legend).getAllByText("19.87%")).toHaveLength(2);
  });

  it("draws a wedge per slice", () => {
    answers["top-sources"] = shares;
    renderWithClient(<TopSourcesCard />);
    expect(screen.getAllByTestId("pie-slice")).toHaveLength(4);
  });

  it("an empty window says so rather than drawing an empty circle", () => {
    answers["top-sources"] = { slices: [] };
    renderWithClient(<TopSourcesCard />);
    expect(screen.getByText("No data to display.")).toBeInTheDocument();
    expect(screen.queryAllByTestId("pie-slice")).toHaveLength(0);
  });
});

describe("SalesCard", () => {
  const sales = {
    days: [
      { date: "2026-09-27", total: 5_000, net: 2_500 },
      { date: "2026-09-28", total: 385_536.03, net: 269_640.41 },
    ],
    total: 390_536.03,
    net: 272_140.41,
  };

  it("heads the chart with Net and Total to the cent", () => {
    answers.sales = sales;
    renderWithClient(<SalesCard />);
    expect(screen.getByText("$272,140.41")).toBeInTheDocument();
    expect(screen.getByText("$390,536.03")).toBeInTheDocument();
  });

  it("two columns a day, Net beside Total", () => {
    answers.sales = sales;
    renderWithClient(<SalesCard />);
    const bars = screen.getAllByTestId("daily-bar");
    expect(bars).toHaveLength(4);
    expect(bars.map((b) => b.dataset.series).slice(0, 2)).toEqual(["Net", "Total"]);
  });

  it("View All goes to Job Statistics", () => {
    answers.sales = sales;
    renderWithClient(<SalesCard />);
    expect(screen.getByRole("link", { name: "View All" })).toHaveAttribute("href", "/reports/job-statistics");
  });
});

describe("the scoreboards", () => {
  const board = {
    rows: [
      { id: "u1", name: "(1) (Betty) Platinum Manager", jobs: 4, sales: 114_383.07 },
      { id: "u2", name: "(1) (Tess) 1 Dispatcher", jobs: 40, sales: 27_240.25 },
    ],
  };

  it("a row per person: who, what they sold, how many jobs", () => {
    answers["dispatch-scoreboard"] = board;
    renderWithClient(<DispatchScoreboardCard />);
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText("(1) (Betty) Platinum Manager")).toBeInTheDocument();
    expect(within(rows[0]).getByText("$114,383.07")).toBeInTheDocument();
    expect(within(rows[0]).getByText("4 Jobs")).toBeInTheDocument();
    expect(within(rows[1]).getByText("40 Jobs")).toBeInTheDocument();
  });

  it("one job is a Job", () => {
    answers["tech-scoreboard"] = { rows: [{ id: "u1", name: "Daniel", jobs: 1, sales: 10 }] };
    renderWithClient(<TechScoreboardCard />);
    expect(screen.getByText("1 Job")).toBeInTheDocument();
  });

  it("without amounts the bar is jobs and no dollar sign appears", () => {
    answers["tech-scoreboard"] = { rows: [{ id: "u1", name: "Daniel", jobs: 5 }, { id: "u2", name: "David", jobs: 44 }] };
    renderWithClient(<TechScoreboardCard />);
    expect(screen.queryByText(/\$/)).toBeNull();
    expect(screen.getAllByTestId("score-bar").map((b) => b.style.width)).toEqual([
      expect.stringMatching(/^11\.3/),
      "100%",
    ]);
  });

  it("a person without a name still has a row", () => {
    answers["tech-scoreboard"] = { rows: [{ id: "u1", name: "", jobs: 2 }] };
    renderWithClient(<TechScoreboardCard />);
    expect(screen.getByText("Unknown user")).toBeInTheDocument();
  });

  it("nobody sold anything: No data to display.", () => {
    answers["tech-scoreboard"] = { rows: [] };
    renderWithClient(<TechScoreboardCard />);
    expect(screen.getByText("No data to display.")).toBeInTheDocument();
  });
});

describe("JobsNowCard", () => {
  it("the four open states in Workiz's order", () => {
    answers["jobs-now"] = { byStatus: { submitted: 237, pending: 306, in_progress: 3, done_pending_approval: 186 } };
    renderWithClient(<JobsNowCard />);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      "Submitted237",
      "Pending306",
      "In progress3",
      "done pending approval186",
    ]);
    expect(screen.getByRole("link", { name: "View All" })).toHaveAttribute("href", "/deals");
  });
});

describe("TodayCard", () => {
  it("sales, then done, canceled and created", () => {
    answers.today = { sales: 51_041.62, jobsDone: 0, jobsCanceled: 0, jobsCreated: 4 };
    renderWithClient(<TodayCard />);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      "Sales$51,041.62",
      "Jobs Done0",
      "Jobs Canceled0",
      "Jobs Created4",
    ]);
  });

  it("no Sales row for somebody who may not see money", () => {
    answers.today = { jobsDone: 1, jobsCanceled: 0, jobsCreated: 4 };
    renderWithClient(<TodayCard />);
    expect(screen.queryByText("Sales")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("TopCallFlowsCard", () => {
  const series = {
    days: ["2026-09-14", "2026-09-15"],
    flows: [
      { name: "(GMB) SURE CT", counts: [64, 48] },
      { name: "MOBILE CT", counts: [30, 0] },
    ],
    atLeast: false,
  };

  it("a line per flow, named in the legend", () => {
    answers["top-call-flows"] = series;
    renderWithClient(<TopCallFlowsCard />);
    expect(screen.getAllByTestId("flow-line")).toHaveLength(2);
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(within(legend).getByText("(GMB) SURE CT")).toBeInTheDocument();
  });

  it("the same numbers as a table for screen readers", () => {
    answers["top-call-flows"] = series;
    renderWithClient(<TopCallFlowsCard />);
    const table = screen.getByRole("table", { name: "Calls per call flow" });
    expect(within(table).getByText("64")).toBeInTheDocument();
  });

  it("no calls went through a flow: No data to display.", () => {
    answers["top-call-flows"] = { days: series.days, flows: [], atLeast: false };
    renderWithClient(<TopCallFlowsCard />);
    expect(screen.getByText("No data to display.")).toBeInTheDocument();
  });
});

describe("RecentCallsCard", () => {
  it("From, To, Call Flow and when — a row per call, linked to the call", () => {
    answers["recent-calls"] = [
      {
        callSid: "CA1",
        direction: "outbound",
        startedAt: new Date(Date.now() - 7 * 3_600_000).toISOString(),
        updatedAt: "",
        fromParty: { kind: "user", id: "u1", name: "(1) (Tom) 4 Dispatcher" },
        toParty: { kind: "contact", id: "c1", name: "Priyank Mwani" },
        flowName: "SURE TX",
      },
    ];
    renderWithClient(<RecentCallsCard />);
    const table = screen.getByRole("table");
    for (const h of ["From", "To", "Call Flow", "Time"]) {
      expect(within(table).getByRole("columnheader", { name: h })).toBeInTheDocument();
    }
    const row = within(table).getAllByRole("row")[1];
    expect(within(row).getByText("(1) (Tom) 4 Dispatcher")).toBeInTheDocument();
    expect(within(row).getByText("Priyank Mwani")).toBeInTheDocument();
    expect(within(row).getByText("SURE TX")).toBeInTheDocument();
    expect(within(row).getByText("7h ago")).toBeInTheDocument();
    expect(within(row).getByLabelText("Outbound")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View All" })).toHaveAttribute("href", "/calls");
  });

  it("no calls: the empty line the spec names", () => {
    answers["recent-calls"] = [];
    renderWithClient(<RecentCallsCard />);
    expect(screen.getByText("No recent calls to display.")).toBeInTheDocument();
  });
});
