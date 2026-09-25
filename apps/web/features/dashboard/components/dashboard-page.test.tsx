import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DealStats } from "@bitcrm/types";
import { DashboardPage } from "./dashboard-page";

const perms = vi.hoisted(() => ({ granted: new Set<string>() }));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({
    can: (resource: string, action = "view") => perms.granted.has(`${resource}.${action}`),
    isLoading: false,
    isTechnician: false,
  }),
}));

const stats = (money: boolean): DealStats => ({
  window: { by: "created", from: "2026-09-19", to: "2026-09-25" },
  jobs: {
    total: 4,
    byStatus: { submitted: 1, in_progress: 1, done: 1, pending: 0, done_pending_approval: 0, canceled: 1 },
  },
  ...(money && {
    money: { revenue: 12_940, tax: 900, cost: 3000, profit: 9040, avgSale: 12_940, avgProfit: 9040, avgPerDay: 1848.57, doneJobs: 1 },
  }),
  series: [{ date: "2026-09-25", jobs: 3, canceled: 1, ...(money && { revenue: 12_940, profit: 9040 }) }],
  byTech: [{ key: "t1", all: 2, done: 2, open: 0, canceled: 0, ...(money && { revenue: 9000 }) }],
  byCreator: [{ key: "d1", all: 3, done: 3, open: 0, canceled: 0, ...(money && { revenue: 12_940 }) }],
  byJobType: [{ key: "jt1", all: 3, done: 3, open: 0, canceled: 0 }],
  bySource: [{ key: "", all: 3, done: 3, open: 0, canceled: 0 }],
  byServiceArea: [{ key: "North", all: 3, done: 3, open: 0, canceled: 0 }],
  byCity: [],
  byZip: [],
});

const useDealStats = vi.hoisted(() => vi.fn());
vi.mock("../hooks", () => ({ useDealStats }));
vi.mock("@/features/deals/hooks", () => ({
  useUserMap: () => ({ map: new Map([["t1", { id: "t1", firstName: "Ann", lastName: "Lee" }], ["d1", { id: "d1", firstName: "Dan", lastName: "Poe" }]]), users: [], isLoading: false }),
  useDealsPage: () => ({ data: { pages: [{ data: [] }] }, isLoading: false }),
}));
vi.mock("@/features/job-types/hooks", () => ({ useJobTypes: () => ({ data: [{ id: "jt1", name: "Lockout" }] }) }));
vi.mock("@/features/job-sources/hooks", () => ({ useJobSources: () => ({ data: [] }) }));
vi.mock("@/features/calls/hooks", () => ({ useCallsList: () => ({ data: { pages: [{ data: [] }] }, isLoading: false }) }));
vi.mock("@/features/calls/use-call-stream", () => ({ useCallStream: () => undefined }));
vi.mock("@/features/invoices/hooks", () => ({
  useInvoiceSummary: () => ({ data: { dueAmount: 500, dueCount: 2, overdueAmount: 100, overdueCount: 1, unsentCount: 3, paidAmount: 0, paidCount: 0, needsInvoiceCount: 4 } }),
  useJobsNeedingInvoice: () => ({ data: [] }),
}));
vi.mock("@/features/estimates/hooks", () => ({
  useEstimateSummary: () => ({ data: { all: { count: 0, amount: 0 } } }),
}));

beforeEach(() => {
  perms.granted = new Set(["deals.view"]);
  useDealStats.mockReset();
  useDealStats.mockImplementation(() => ({ data: stats(perms.granted.has("financials.view")), isLoading: false }));
});

describe("DashboardPage", () => {
  it("leads with the money for a viewer who may see it", () => {
    perms.granted.add("financials.view");
    render(<DashboardPage today="2026-09-25" />);

    expect(screen.getByText("Total revenue").parentElement).toHaveTextContent("$12.9K");
    expect(screen.getByText("Net profit").parentElement).toHaveTextContent("$9,040");
    const techs = screen.getByRole("region", { name: "Tech scoreboard" });
    expect(within(techs).getByText("Ann Lee").closest("li")).toHaveTextContent("$9,000");
  });

  it("shows counts only — no amount anywhere — without financials.view", () => {
    render(<DashboardPage today="2026-09-25" />);

    expect(screen.queryByText("Total revenue")).toBeNull();
    expect(screen.getByText("Total jobs").parentElement).toHaveTextContent("4");
    expect(screen.queryByText(/\$\d/)).toBeNull();
    const techs = screen.getByRole("region", { name: "Tech scoreboard" });
    expect(within(techs).getByText("Ann Lee").closest("li")).toHaveTextContent("2 jobs");
  });

  it("renders each widget only for the permission behind it", () => {
    const { unmount } = render(<DashboardPage today="2026-09-25" />);
    expect(screen.queryByRole("region", { name: "Recent calls" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Invoices" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Estimates" })).toBeNull();
    unmount();

    perms.granted = new Set(["deals.view", "calls.view", "invoices.view", "estimates.view"]);
    render(<DashboardPage today="2026-09-25" />);
    expect(screen.getByRole("region", { name: "Recent calls" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Invoices" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Estimates" })).toBeInTheDocument();
  });

  it("names the breakdown rows and calls an unset one Not set", () => {
    render(<DashboardPage today="2026-09-25" />);
    expect(within(screen.getByRole("region", { name: "Top job types" })).getByText("Lockout")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Top sources" })).getByText("Not set")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Dispatch scoreboard" })).getByText("Dan Poe")).toBeInTheDocument();
  });

  it("opens on the last 30 days and recounts for another period", async () => {
    render(<DashboardPage today="2026-09-25" />);
    expect(useDealStats).toHaveBeenLastCalledWith({ from: "2026-08-27", to: "2026-09-25" }, true);

    await userEvent.click(screen.getByRole("combobox", { name: "Period" }));
    await userEvent.click(await screen.findByRole("option", { name: "Last 7 days" }));

    expect(useDealStats).toHaveBeenLastCalledWith({ from: "2026-09-19", to: "2026-09-25" }, true);
  });
});
