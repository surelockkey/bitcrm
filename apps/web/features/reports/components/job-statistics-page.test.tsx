import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JobStatistics, JobStatisticsRow, JobStatisticsTab, JobStatisticsTable } from "@bitcrm/types";
import { JobStatisticsPage } from "./job-statistics-page";

const perms = vi.hoisted(() => ({ granted: new Set<string>() }));
vi.mock("@/features/auth/use-permissions", () => ({
  // This suite asserts the refusal, so `useDenied` mirrors its own `can`
  // instead of declaring that nobody is ever refused.
  useDenied: () => (resource: string, action = "view") => !perms.granted.has(`${resource}.${action}`),
  usePermissions: () => ({
    can: (resource: string, action = "view") => perms.granted.has(`${resource}.${action}`),
    isLoading: false,
  }),
}));

const row = (key: string, label: string, all: number, done: number, canceled: number, money: boolean, over: Partial<JobStatisticsRow> = {}): JobStatisticsRow => ({
  key,
  label,
  all,
  done,
  open: all - done - canceled,
  canceled,
  canceledPct: Math.round((canceled / all) * 10_000) / 100,
  ...(money && { gross: done * 150, profit: done * 110, avgSale: 150, avgProfit: 110 }),
  ...over,
});
const table = (rows: JobStatisticsRow[]): JobStatisticsTable => ({
  rows,
  totals: {
    all: rows.reduce((n, r) => n + r.all, 0),
    done: rows.reduce((n, r) => n + r.done, 0),
    open: rows.reduce((n, r) => n + r.open, 0),
    canceled: rows.reduce((n, r) => n + r.canceled, 0),
    canceledPct: 20,
    ...(rows[0]?.gross !== undefined && { gross: 300, profit: 220, avgSale: 150, avgProfit: 110 }),
  },
});

/** The answer the server gives this caller: money only with financials.view, the tabs it grants. */
const answer = (money: boolean, profit = money, tabs: JobStatisticsTab[] = ["sources", "tech", "area", "dispatcher", "jobTypes"]): JobStatistics => ({
  window: { by: "end", from: "2026-09-01", to: "2026-09-25" },
  access: { money, profit, tabs },
  kpis: {
    all: 6,
    done: 2,
    open: 3,
    canceled: 1,
    canceledPct: 16.67,
    submitted: 1,
    inProgress: 2,
    pending: 0,
    donePendingApproval: 0,
    ...(money && { gross: 661170.03, avgSale: 150, techExpenses: 20, laborCost: 0 }),
    ...(profit && { profit: 434178.72, avgProfit: 110 }),
  },
  series: [{ date: "2026-09-01", jobs: 6, canceled: 1, done: 2, ...(money && { sales: 300 }), ...(profit && { profit: 220 }) }],
  sources: table([
    row("ad:GMB", "SURE TX DENISON GMB", 5, 2, 1, money, { kind: "ad" }),
    row("external:e1", "Papas Lock Out Service", 1, 0, 0, money, { kind: "external" }),
  ]),
  tech: table([
    row("tech:t1+t2", "Ann Lee + Bob Ray", 4, 2, 1, money, { techIds: ["t1", "t2"], ...(money && { laborCost: 0, techExpenses: 20 }) }),
    row("unassigned", "", 1, 0, 1, money, { techIds: [], ...(money && { laborCost: 0, techExpenses: 0 }) }),
  ]),
  area: {
    metro: table([row("area:sa1", "SURE LOCK CT", 5, 2, 1, money)]),
    city: table([row("city:Hartford", "Hartford", 5, 2, 1, money, { serviceArea: "SURE LOCK CT" })]),
    zip: table([row("zip:06107", "06107", 5, 2, 1, money, { city: "Hartford" })]),
    withoutArea: 1,
  },
  dispatcher: table([row("user:d1", "Kendall", 6, 2, 1, money)]),
  jobTypes: table([row("type:jt1", "Car key", 6, 2, 1, money)]),
  warnings: [],
});

const useJobStatistics = vi.hoisted(() => vi.fn());
vi.mock("../job-statistics/hooks", () => ({ useJobStatistics }));
vi.mock("@/features/job-tags/hooks", () => ({ useJobTags: () => ({ data: [{ id: "tag1", name: "VIP", active: true }] }) }));
vi.mock("@/features/job-tags/lib", () => ({ activeJobTags: (tags?: unknown[]) => tags ?? [] }));
vi.mock("@/features/service-areas/hooks", () => ({
  useServiceAreas: () => ({ data: [{ id: "sa1", name: "SURE LOCK CT", active: true }] }),
}));

const params = () => new URLSearchParams(useJobStatistics.mock.lastCall![0] as string);

beforeEach(() => {
  perms.granted = new Set(["reports.view"]);
  useJobStatistics.mockReset();
  useJobStatistics.mockImplementation(() => ({ data: answer(perms.granted.has("financials.view")), isLoading: false }));
});

describe("JobStatisticsPage", () => {
  it("opens on this month, By Time: Closed — the visit's end (Workiz)", () => {
    render(<JobStatisticsPage today="2026-09-25" />);
    expect(Object.fromEntries(params())).toEqual({ by: "end", from: "2026-09-01", to: "2026-09-25" });
    expect(screen.getByRole("radio", { name: "Closed" })).toBeChecked();
  });

  it("recounts on another date, period, area and tags", async () => {
    render(<JobStatisticsPage today="2026-09-25" />);
    await userEvent.click(screen.getByRole("radio", { name: "Created" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Date preset" }), "last_month");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Service area" }), "sa1");
    await userEvent.click(screen.getByRole("button", { name: "VIP" }));
    expect(Object.fromEntries(params())).toEqual({ by: "created", from: "2026-08-01", to: "2026-08-31", serviceAreaId: "sa1", tagId: "tag1" });
  });

  it("shows Workiz's six KPIs — sales and profit only when the server sends them", () => {
    const { unmount } = render(<JobStatisticsPage today="2026-09-25" />);
    expect(screen.getByText("Jobs Done").parentElement).toHaveTextContent("2");
    expect(screen.getByText("Jobs Submitted").parentElement).toHaveTextContent("1");
    expect(screen.getByText("Jobs In Progress").parentElement).toHaveTextContent("2");
    expect(screen.getByText("Jobs Canceled").parentElement).toHaveTextContent("1");
    expect(screen.queryByText("Total Sales")).toBeNull();
    unmount();

    perms.granted.add("financials.view");
    render(<JobStatisticsPage today="2026-09-25" />);
    expect(screen.getByText("Total Sales").parentElement).toHaveTextContent("$661,170.03");
    expect(screen.getByText("Total Profit").parentElement).toHaveTextContent("$434,178.72");
  });

  it("hides the profit, not the sales, without View Profit", () => {
    useJobStatistics.mockImplementation(() => ({ data: answer(true, false), isLoading: false }));
    render(<JobStatisticsPage today="2026-09-25" />);
    expect(screen.getByText("Total Sales")).toBeInTheDocument();
    expect(screen.queryByText("Total Profit")).toBeNull();
  });

  it("gives each tech combination one row, unassigned included, with Labor cost and Tech expenses", async () => {
    perms.granted.add("financials.view");
    render(<JobStatisticsPage today="2026-09-25" />);
    await userEvent.click(screen.getByRole("tab", { name: "Tech Performance" }));

    const t = screen.getByRole("table", { name: "Tech Performance" });
    expect(within(t).getByRole("columnheader", { name: "Tech expenses" })).toBeInTheDocument();
    const rows = within(t).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Ann Lee + Bob Ray");
    expect(rows[1]).toHaveTextContent("$20.00");
    expect(rows[2]).toHaveTextContent("Unassigned");
    expect(rows.at(-1)).toHaveTextContent("Totals:");
    expect(rows.at(-1)).toHaveTextContent("5");
    expect(screen.getByText("By Done Jobs")).toBeInTheDocument();
  });

  it("switches Sources to referrals only, and keeps the money columns out without financials.view", async () => {
    render(<JobStatisticsPage today="2026-09-25" />);
    await userEvent.click(screen.getByRole("tab", { name: "Sources" }));
    const t = () => screen.getByRole("table", { name: "Sources" });
    expect(within(t()).getByText("SURE TX DENISON GMB")).toBeInTheDocument();
    expect(within(t()).queryByText("Gross Amount")).toBeNull();
    expect(screen.queryByText("By Sales Amount")).toBeNull();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Source type" }), "external");
    expect(within(t()).queryByText("SURE TX DENISON GMB")).toBeNull();
    expect(within(t()).getByText("Papas Lock Out Service")).toBeInTheDocument();
  });

  it("drills areas down to city and zip, and says which jobs have no area", async () => {
    render(<JobStatisticsPage today="2026-09-25" />);
    await userEvent.click(screen.getByRole("tab", { name: "Area Performance" }));
    const t = () => screen.getByRole("table", { name: "Area Performance" });
    expect(within(t()).getByText("SURE LOCK CT")).toBeInTheDocument();
    expect(screen.getByText(/1 job without a service area/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "City" }));
    expect(within(t()).getByRole("columnheader", { name: "Service Area" })).toBeInTheDocument();
    expect(within(t()).getByText("Hartford")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Zip" }));
    expect(within(t()).getByText("06107")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Search" }), "nowhere");
    expect(screen.getByText("No data found")).toBeInTheDocument();
  });

  it("shows only the tabs the server opened to this caller", () => {
    useJobStatistics.mockImplementation(() => ({ data: { ...answer(false, false, ["tech"]), sources: undefined }, isLoading: false }));
    render(<JobStatisticsPage today="2026-09-25" />);
    expect(screen.getByRole("tab", { name: "Tech Performance" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Sources" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Dispatcher Performance" })).toBeNull();
  });

  it("passes the server's warnings on", () => {
    useJobStatistics.mockImplementation(() => ({ data: { ...answer(true), warnings: ["Technician rates could not be read"] }, isLoading: false }));
    render(<JobStatisticsPage today="2026-09-25" />);
    expect(screen.getByRole("status")).toHaveTextContent("Technician rates could not be read");
  });

  it("is closed to anyone without the reports permission", () => {
    perms.granted = new Set(["deals.view"]);
    render(<JobStatisticsPage today="2026-09-25" />);
    expect(screen.getByText(/no access/i)).toBeInTheDocument();
  });
});
