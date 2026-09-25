import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DealStats } from "@bitcrm/types";
import { JobStatisticsPage } from "./job-statistics-page";

const perms = vi.hoisted(() => ({ granted: new Set<string>() }));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({
    can: (resource: string, action = "view") => perms.granted.has(`${resource}.${action}`),
    isLoading: false,
  }),
}));

const b = (key: string, all: number, done: number, open: number, canceled: number, money: boolean, revenue = 0, profit = 0) => ({
  key, all, done, open, canceled, ...(money && { revenue, profit }),
});

const stats = (money: boolean): DealStats => ({
  window: { by: "closed", from: "2026-09-01", to: "2026-09-25" },
  jobs: { total: 6, byStatus: { submitted: 1, in_progress: 2, done: 2, pending: 0, done_pending_approval: 0, canceled: 1 } },
  ...(money && {
    money: { revenue: 300, tax: 20, cost: 60, profit: 220, avgSale: 150, avgProfit: 110, avgPerDay: 12, doneJobs: 2 },
  }),
  series: [{ date: "2026-09-01", jobs: 5, canceled: 1, ...(money && { revenue: 300, profit: 220 }) }],
  byTech: [b("t1", 4, 2, 1, 1, money, 300, 220), b("t2", 1, 0, 1, 0, money)],
  byCreator: [b("d1", 6, 2, 3, 1, money, 300, 220)],
  byJobType: [],
  bySource: [b("s1", 6, 2, 3, 1, money, 300, 220)],
  byServiceArea: [b("North", 6, 2, 3, 1, money, 300, 220)],
  byCity: [b("Atlanta", 6, 2, 3, 1, money, 300, 220)],
  byZip: [b("30301", 6, 2, 3, 1, money, 300, 220)],
});

const useJobStatistics = vi.hoisted(() => vi.fn());
vi.mock("../job-statistics/hooks", () => ({ useJobStatistics }));
vi.mock("@/features/deals/hooks", () => ({
  useUserMap: () => ({ map: new Map([["t1", { id: "t1", firstName: "Ann", lastName: "Lee" }]]), users: [], isLoading: false }),
}));
vi.mock("@/features/job-sources/hooks", () => ({ useJobSources: () => ({ data: [{ id: "s1", name: "Google Ads" }] }) }));
vi.mock("@/features/job-tags/hooks", () => ({ useJobTags: () => ({ data: [] }) }));
vi.mock("@/features/service-areas/hooks", () => ({ useServiceAreas: () => ({ data: [] }) }));

beforeEach(() => {
  perms.granted = new Set(["reports.view", "deals.view"]);
  useJobStatistics.mockReset();
  useJobStatistics.mockImplementation(() => ({ data: stats(perms.granted.has("financials.view")), isLoading: false }));
});

describe("JobStatisticsPage", () => {
  it("opens on this month, by the day jobs closed (Workiz)", () => {
    render(<JobStatisticsPage today="2026-09-25" />);
    expect(useJobStatistics).toHaveBeenLastCalledWith({ by: "closed", from: "2026-09-01", to: "2026-09-25" });
  });

  it("recounts on another date and period", async () => {
    render(<JobStatisticsPage today="2026-09-25" />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "By time" }), "created");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Date preset" }), "last_month");
    expect(useJobStatistics).toHaveBeenLastCalledWith({ by: "created", from: "2026-08-01", to: "2026-08-31" });
  });

  it("shows the job counts, and sales and profit only with financials.view", () => {
    const { unmount } = render(<JobStatisticsPage today="2026-09-25" />);
    expect(screen.getByText("Jobs Done").parentElement).toHaveTextContent("2");
    expect(screen.getByText("Jobs In Progress").parentElement).toHaveTextContent("2");
    expect(screen.queryByText("Total Sales")).toBeNull();
    unmount();

    perms.granted.add("financials.view");
    render(<JobStatisticsPage today="2026-09-25" />);
    expect(screen.getByText("Total Sales").parentElement).toHaveTextContent("$300");
    expect(screen.getByText("Total Profit").parentElement).toHaveTextContent("$220");
  });

  it("breaks the period down per tech with a Totals row", async () => {
    perms.granted.add("financials.view");
    render(<JobStatisticsPage today="2026-09-25" />);
    await userEvent.click(screen.getByRole("tab", { name: "Tech Performance" }));

    const table = screen.getByRole("table", { name: "Tech Performance" });
    const rows = within(table).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Ann Lee");
    expect(rows[1]).toHaveTextContent("25%");
    expect(rows[1]).toHaveTextContent("$150.00");
    expect(rows.at(-1)).toHaveTextContent("Totals");
    expect(rows.at(-1)).toHaveTextContent("5");
  });

  it("keeps money columns out without financials.view", async () => {
    render(<JobStatisticsPage today="2026-09-25" />);
    await userEvent.click(screen.getByRole("tab", { name: "Sources" }));
    const table = screen.getByRole("table", { name: "Sources" });
    expect(within(table).getByText("Google Ads")).toBeInTheDocument();
    expect(within(table).queryByText("Gross Amount")).toBeNull();
  });

  it("drills areas down to city and zip", async () => {
    render(<JobStatisticsPage today="2026-09-25" />);
    await userEvent.click(screen.getByRole("tab", { name: "Area Performance" }));
    expect(within(screen.getByRole("table", { name: "Area Performance" })).getByText("North")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Zip" }));
    expect(within(screen.getByRole("table", { name: "Area Performance" })).getByText("30301")).toBeInTheDocument();
  });

  it("is closed to anyone without the reports permission", () => {
    perms.granted = new Set(["deals.view"]);
    render(<JobStatisticsPage today="2026-09-25" />);
    expect(screen.getByText(/no access/i)).toBeInTheDocument();
  });
});
