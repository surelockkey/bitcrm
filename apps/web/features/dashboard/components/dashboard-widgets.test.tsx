import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithClient } from "@/test/render-with-client";
import {
  ComingUpCard,
  DispatchScoreboardCard,
  EstimatesCard,
  InvoicesCard,
  JobsNowCard,
  RecentActivityCard,
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
  useDenied: () => () => false,
  usePermissions: () => ({
    can: (resource: string, action: string) => grants[`${resource}.${action}`] ?? false,
  }),
}));

const answers: Record<string, unknown> = {};
const seen: string[] = [];
const seenWindows: unknown[] = [];
const q = (data: unknown) => ({
  data,
  isLoading: false,
  isError: false,
  isFetching: false,
  dataUpdatedAt: Date.parse("2026-10-08T07:08:00.000Z"),
  refetch: vi.fn(),
});

vi.mock("../hooks", () => ({
  useRangeWidget: (name: string, _fetch: unknown, window: unknown) => {
    seen.push(name);
    seenWindows.push(window);
    return q(answers[name]);
  },
  useToday: () => q(answers.today),
  useJobsNow: () => q(answers["jobs-now"]),
  useRecentCalls: () => q(answers["recent-calls"]),
  useInvoicesWidget: (window: unknown) => {
    seenWindows.push(window);
    return q(answers.invoices);
  },
  useEstimatesWidget: () => q(answers.estimates),
  useComingUp: () => q(answers["coming-up"]),
  useRecentActivity: () => q(answers["recent-activity"]),
  useCollectedToday: (_day: string, enabled: boolean) => q(enabled ? answers.collected : undefined),
}));

const NOW = new Date("2026-10-08T21:00:00Z"); // 5 PM in New York, a Thursday

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
  seen.length = 0;
  seenWindows.length = 0;
  for (const k of Object.keys(answers)) delete answers[k];
  for (const k of Object.keys(grants)) delete grants[k];
});
afterEach(() => vi.useRealTimers());

const shares = {
  slices: [
    { key: "s1", name: "SURE TX PLATINUM", count: 46, percent: 30.46 },
    { key: "s2", name: "MOBILE CT LOCKSMITH", count: 45, percent: 29.8 },
    { key: "s3", name: "SURE CT NEW HAVEN", count: 30, percent: 19.87 },
    { key: "s4", name: "SURE CT GOOGLE ADS", count: 30, percent: 19.87 },
  ],
};

/** Workiz's pies: four slices, the 2×2 legend of names over percents. */
describe("the pies — Top Sources, Top Job Types, Service Areas", () => {
  it.each([
    [TopSourcesCard, "Top Sources", "top-sources"],
    [TopJobTypesCard, "Top Job Types", "top-job-types"],
    [ServiceAreasCard, "Service Areas", "service-areas"],
  ])("%o reads its own widget, titles and stamps itself, and has no ?", (Card, title, name) => {
    answers[name] = shares;
    renderWithClient(<Card />);
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByText(/^updated /)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `About ${title}` })).toBeNull();
    expect(seen).toContain(name);
  });

  it("names every slice with its percent, a wedge each", () => {
    answers["top-sources"] = shares;
    renderWithClient(<TopSourcesCard />);
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(within(legend).getByText("SURE TX PLATINUM")).toBeInTheDocument();
    expect(within(legend).getByText("30.46%")).toBeInTheDocument();
    expect(within(legend).getAllByText("19.87%")).toHaveLength(2);
    expect(document.querySelectorAll("[data-slot=wz-pie-slice]")).toHaveLength(4);
  });

  it("an empty window says so rather than drawing an empty circle", () => {
    answers["top-sources"] = { slices: [] };
    renderWithClient(<TopSourcesCard />);
    expect(screen.getByText("No data to display")).toBeInTheDocument();
  });
});

describe("every ranged widget opens on Workiz's Last 14 days", () => {
  it.each([
    [TopSourcesCard, "top-sources"],
    [TopJobTypesCard, "top-job-types"],
    [ServiceAreasCard, "service-areas"],
    [SalesCard, "sales"],
    [TechScoreboardCard, "tech-scoreboard"],
    [DispatchScoreboardCard, "dispatch-scoreboard"],
    [TopCallFlowsCard, "top-call-flows"],
  ])("%o", (Card, name) => {
    answers[name] = {
      sales: { days: [], total: 0, net: 0 },
      "tech-scoreboard": { rows: [] },
      "dispatch-scoreboard": { rows: [] },
      "top-call-flows": { days: [], flows: [], atLeast: false },
    }[name] ?? { slices: [] };
    renderWithClient(<Card />);
    expect(seenWindows[0]).toEqual({ from: "2026-09-24", to: "2026-10-08" });
    expect(screen.getByRole("button", { name: "Range: Last 14 days" })).toBeInTheDocument();
  });
});

describe("SalesCard", () => {
  const sales = {
    days: [
      { date: "2026-10-07", total: 5_000, net: 2_500 },
      { date: "2026-10-08", total: 385_536.03, net: 269_640.41 },
    ],
    total: 390_536.03,
    net: 272_140.41,
  };

  it("heads the chart with Net and Total to the cent, and explains itself", () => {
    answers.sales = sales;
    renderWithClient(<SalesCard />);
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(within(legend).getAllByRole("listitem").map((i) => i.textContent)).toEqual([
      "Net $272,140.41",
      "Total $390,536.03",
    ]);
    expect(screen.getByRole("button", { name: "About Sales" })).toBeInTheDocument();
  });

  it("two columns a day, Net beside Total", () => {
    answers.sales = sales;
    renderWithClient(<SalesCard />);
    const bars = [...document.querySelectorAll<HTMLElement>("[data-slot=wz-chart-bar]")];
    expect(bars).toHaveLength(4);
    expect(bars.map((b) => b.dataset.series).slice(0, 2)).toEqual(["Net", "Total"]);
  });

  it("View All goes to Job Statistics, without Workiz's underline", () => {
    answers.sales = sales;
    renderWithClient(<SalesCard />);
    const link = screen.getByRole("link", { name: "View All" });
    expect(link).toHaveAttribute("href", "/reports/job-statistics");
    expect(link.className).not.toMatch(/(^|\s)underline(\s|$)/);
  });
});

describe("InvoicesCard", () => {
  const summary = { due: { count: 565, amount: 491_172.9 }, overdue: { count: 306, amount: 114_352.97 } };

  it("opens on All time with Due and Past Due — invoices and the money", () => {
    grants["financials.view"] = true;
    answers.invoices = summary;
    renderWithClient(<InvoicesCard />);
    expect(seenWindows[0]).toBeUndefined();
    expect(screen.getByRole("button", { name: "Range: All time" })).toBeInTheDocument();
    const stats = [...document.querySelectorAll("[data-slot=wz-widget-stat]")].map((s) => s.textContent);
    expect(stats).toEqual(["Due565 Invoices$491,172.90", "Past Due306 Invoices$114,352.97"]);
    expect(screen.getByRole("link", { name: "View All" })).toHaveAttribute("href", "/invoices");
    expect(screen.getByRole("button", { name: "About Invoices" })).toBeInTheDocument();
  });

  it("counts alone for somebody who may not see money", () => {
    answers.invoices = summary;
    renderWithClient(<InvoicesCard />);
    expect(screen.queryByText(/\$/)).toBeNull();
    expect(screen.getByText("565")).toBeInTheDocument();
  });
});

describe("EstimatesCard", () => {
  const summary = {
    unsent: { count: 51, amount: 8_081_390.29 },
    pending: { count: 299, amount: 9_275_319.37 },
    approved: { count: 51, amount: 446_078.89 },
    declined: { count: 161, amount: 685_766.95 },
    won: { count: 9, amount: 1 },
    archived: { count: 2, amount: 1 },
  };

  it("Workiz's four statuses, each worth its sum", () => {
    grants["financials.view"] = true;
    answers.estimates = summary;
    renderWithClient(<EstimatesCard />);
    const stats = [...document.querySelectorAll("[data-slot=wz-widget-stat]")].map((s) => s.textContent);
    expect(stats).toEqual([
      "UnsentWorth $8,081,390.2951",
      "PendingWorth $9,275,319.37299",
      "ApprovedWorth $446,078.8951",
      "DeclinedWorth $685,766.95161",
    ]);
    expect(screen.getByRole("link", { name: "View All" })).toHaveAttribute("href", "/estimates");
  });

  it("no Worth for somebody who may not see money", () => {
    answers.estimates = summary;
    renderWithClient(<EstimatesCard />);
    expect(screen.queryByText(/Worth/)).toBeNull();
  });
});

describe("ComingUpCard", () => {
  it("the next visits: when, who, where — each opening its job", () => {
    answers["coming-up"] = {
      deals: [
        {
          id: "d1",
          contactId: "c1",
          scheduledDate: "2026-10-08",
          scheduledTimeSlot: "10:00-11:00",
          address: { street: "271 Dunham St", city: "Southington", state: "Connecticut", zip: "" },
        },
      ],
      clients: { c1: "Kathy Miandino" },
    };
    renderWithClient(<ComingUpCard />);
    const link = screen.getByRole("link", { name: /Kathy Miandino/ });
    expect(link).toHaveAttribute("href", "/deals/d1");
    expect(link).toHaveTextContent("7 hours ago");
    expect(link).toHaveTextContent("271 Dunham St Southington Connecticut");
    expect(screen.getByRole("link", { name: "View All" })).toHaveAttribute("href", "/schedule");
  });

  it("nothing scheduled says so", () => {
    answers["coming-up"] = { deals: [], clients: {} };
    renderWithClient(<ComingUpCard />);
    expect(screen.getByText("Nothing on your schedule")).toBeInTheDocument();
  });
});

describe("RecentActivityCard", () => {
  it("who, what, which job and when", () => {
    answers["recent-activity"] = [
      {
        id: "a1",
        timestamp: new Date(NOW.getTime() - 7 * 3_600_000).toISOString(),
        actorId: "w1",
        actorName: "(1) (Evelyn) 2 Dispatcher",
        who: "(1) (Evelyn) 2 Dispatcher",
        imported: true,
        text: "Update job details",
        source: "web",
        dealId: "d9",
        jobRef: "C2ZNRU",
      },
    ];
    renderWithClient(<RecentActivityCard />);
    const row = screen.getAllByRole("listitem")[0];
    expect(within(row).getByText("(1) (Evelyn) 2 Dispatcher")).toBeInTheDocument();
    expect(within(row).getByText("Update job details")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "#C2ZNRU" })).toHaveAttribute("href", "/deals/d9");
    expect(within(row).getByText("7 hours ago")).toBeInTheDocument();
    expect(within(row).getByLabelText("Web app")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View All" })).toHaveAttribute("href", "/reports/activity");
  });
});

describe("the scoreboards", () => {
  const board = {
    rows: [
      { id: "u1", name: "(1) (Riley) Platinum Manager", jobs: 8, sales: 22_570.64 },
      { id: "u2", name: "(1G) (Jessica) Platinum CSR", jobs: 20, sales: 21_198.32 },
      { id: "u3", name: "C", jobs: 1, sales: 3 },
      { id: "u4", name: "D", jobs: 1, sales: 2 },
      { id: "u5", name: "E", jobs: 1, sales: 1 },
    ],
  };

  it("four people, as Workiz shows: who, what they sold on the bar, how many jobs", () => {
    answers["dispatch-scoreboard"] = board;
    renderWithClient(<DispatchScoreboardCard />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText("(1) (Riley) Platinum Manager")).toBeInTheDocument();
    expect(within(rows[0]).getByText("$22,570.64")).toBeInTheDocument();
    expect(within(rows[0]).getByText("8 Jobs")).toBeInTheDocument();
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
    expect(screen.getAllByTestId("score-bar").map((b) => b.style.width)).toEqual([expect.stringMatching(/^11\.3/), "100%"]);
  });

  it("a person without a name still has a row", () => {
    answers["tech-scoreboard"] = { rows: [{ id: "u1", name: "", jobs: 2 }] };
    renderWithClient(<TechScoreboardCard />);
    expect(screen.getByText("Unknown user")).toBeInTheDocument();
  });

  it("nobody sold anything: No data to display", () => {
    answers["tech-scoreboard"] = { rows: [] };
    renderWithClient(<TechScoreboardCard />);
    expect(screen.getByText("No data to display")).toBeInTheDocument();
  });
});

describe("JobsNowCard", () => {
  it("the four open states in Workiz's order, each with its coloured rule", () => {
    answers["jobs-now"] = { byStatus: { submitted: 198, pending: 330, in_progress: 15, done_pending_approval: 186 } };
    renderWithClient(<JobsNowCard />);
    const stats = [...document.querySelectorAll("[data-slot=wz-widget-stat]")];
    expect(stats.map((r) => r.textContent)).toEqual([
      "Submitted198",
      "Pending330",
      "In progress15",
      "done pending approval186",
    ]);
    expect(stats[0].className).toContain("border-wz-stat-green");
    expect(stats[3].className).toContain("border-wz-chart-canceled");
    expect(screen.getByRole("link", { name: "View All" })).toHaveAttribute("href", "/deals");
  });
});

describe("TodayCard", () => {
  const stats = () => [...document.querySelectorAll("[data-slot=wz-widget-stat]")].map((r) => r.textContent);

  it("sales and collected, then done, canceled and created", () => {
    grants["financials.view"] = true;
    grants["payments.view"] = true;
    answers.today = { sales: 41_420.22, jobsDone: 28, jobsCanceled: 31, jobsCreated: 101 };
    answers.collected = 13_256.6;
    renderWithClient(<TodayCard />);
    expect(stats()).toEqual([
      "Sales$41,420.22",
      "Collected$13,256.60",
      "Jobs Done28",
      "Jobs Canceled31",
      "Jobs Created101",
    ]);
  });

  it("no money rows for somebody who may not see money", () => {
    answers.today = { jobsDone: 1, jobsCanceled: 0, jobsCreated: 4 };
    answers.collected = 99;
    renderWithClient(<TodayCard />);
    expect(stats()).toEqual(["Jobs Done1", "Jobs Canceled0", "Jobs Created4"]);
  });
});

describe("TopCallFlowsCard", () => {
  const series = {
    days: ["2026-10-07", "2026-10-08"],
    flows: [
      { name: "(GMB) SURE CT", counts: [64, 48] },
      { name: "MOBILE CT", counts: [30, 0] },
    ],
    atLeast: false,
  };

  it("a line per flow, named in the legend, with no stamp — Workiz shows none", () => {
    answers["top-call-flows"] = series;
    renderWithClient(<TopCallFlowsCard />);
    expect(document.querySelectorAll("[data-slot=wz-chart-line]")).toHaveLength(2);
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(within(legend).getByText("(GMB) SURE CT")).toBeInTheDocument();
    expect(screen.queryByText(/^updated /)).toBeNull();
    expect(screen.getByRole("link", { name: "View All" })).toHaveAttribute("href", "/reports/call-tracking");
  });

  it("the same numbers as a table for screen readers", () => {
    answers["top-call-flows"] = series;
    renderWithClient(<TopCallFlowsCard />);
    const table = screen.getByRole("table", { name: "Calls per call flow" });
    expect(within(table).getByText("64")).toBeInTheDocument();
  });

  it("no calls went through a flow: No data to display", () => {
    answers["top-call-flows"] = { days: series.days, flows: [], atLeast: false };
    renderWithClient(<TopCallFlowsCard />);
    expect(screen.getByText("No data to display")).toBeInTheDocument();
  });
});

describe("RecentCallsCard", () => {
  it("From, To, Call Flow and Time — a row per call, linked to the call", () => {
    answers["recent-calls"] = [
      {
        callSid: "CA1",
        direction: "outbound",
        status: "completed",
        startedAt: new Date(NOW.getTime() - 7 * 3_600_000).toISOString(),
        updatedAt: "",
        fromParty: { kind: "user", id: "u1", name: "(Tracy) 28 Dispatcher" },
        toParty: { kind: "contact", id: "c1", name: "Client 2427" },
        flowName: "SURE TX",
      },
    ];
    renderWithClient(<RecentCallsCard />);
    const table = screen.getByRole("table");
    for (const h of ["From", "To", "Call Flow", "Time"]) {
      expect(within(table).getByRole("columnheader", { name: h })).toBeInTheDocument();
    }
    const row = within(table).getAllByRole("row")[1];
    expect(within(row).getByText("(Tracy) 28 Dispatcher")).toBeInTheDocument();
    expect(within(row).getByText("Client 2427")).toBeInTheDocument();
    expect(within(row).getByText("SURE TX")).toBeInTheDocument();
    expect(within(row).getByText("7 hours ago")).toBeInTheDocument();
    expect(within(row).getByLabelText("Outbound")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View All" })).toHaveAttribute("href", "/calls");
  });

  it("a missed call says so", () => {
    answers["recent-calls"] = [
      { callSid: "CA2", direction: "inbound", status: "no-answer", startedAt: NOW.toISOString(), updatedAt: "", flowName: "X" },
    ];
    renderWithClient(<RecentCallsCard />);
    expect(screen.getByLabelText("Inbound, missed")).toBeInTheDocument();
  });

  it("no calls: the empty line", () => {
    answers["recent-calls"] = [];
    renderWithClient(<RecentCallsCard />);
    expect(screen.getByText("No recent calls to display")).toBeInTheDocument();
  });
});
