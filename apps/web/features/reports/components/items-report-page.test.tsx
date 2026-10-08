import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ItemsReportJobsPage, ItemsReportPage, ItemsReportRow } from "@bitcrm/types";
import { ItemsReportPage as Page } from "./items-report-page";

const perms = vi.hoisted(() => ({ granted: new Set<string>() }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => (resource: string, action = "view") => !perms.granted.has(`${resource}.${action}`),
  usePermissions: () => ({
    can: (resource: string, action = "view") => perms.granted.has(`${resource}.${action}`),
    isLoading: false,
  }),
}));

const hooks = vi.hoisted(() => ({ useItemsReport: vi.fn(), useItemsReportJobs: vi.fn() }));
vi.mock("../items/hooks", () => ({ useItemsReport: hooks.useItemsReport, useItemsReportJobs: hooks.useItemsReportJobs }));
const download = vi.hoisted(() => vi.fn());
vi.mock("../items/api", () => ({ downloadItemsReportCsv: download }));
vi.mock("@/features/job-types/hooks", () => ({ useJobTypes: () => ({ data: [{ id: "jt1", name: "Car key" }] }) }));

const row = (over: Partial<ItemsReportRow> = {}): ItemsReportRow => ({
  key: "p-17011",
  productId: "p-17011",
  number: 17011,
  name: "Norton 410xTPH Door Closer with Hold Open Arm",
  type: "product",
  model: "TPHdc (SLK-17011)",
  category: "Door Hardware",
  units: 10,
  price: 4965.7,
  cost: 2710,
  profit: 2255.7,
  margin: 45.43,
  jobs: 1,
  servicePlan: false,
  ...over,
});

const pageOf = (rows: ItemsReportRow[], over: Partial<ItemsReportPage> = {}): ItemsReportPage => ({
  rows,
  totals: { items: rows.length, units: 6597.85, price: 678418.94, cost: 66156.02, profit: 612262.92, margin: 90.25 },
  pagination: { page: 1, pageSize: 50, total: rows.length, pages: 1, from: rows.length ? 1 : 0, to: rows.length },
  window: { from: "2026-09-01", to: "2026-09-29" },
  sort: { column: "number", dir: "desc" },
  money: true,
  options: { categories: ["Door Hardware", "Keys & Remotes"], soldBy: [{ id: "u1", name: "Betty Manager" }] },
  ...over,
});

const jobsOf = (over: Partial<ItemsReportJobsPage> = {}): ItemsReportJobsPage => ({
  item: row(),
  rows: [
    {
      dealId: "d1",
      jobNumber: "NII265",
      jobSerial: 372833,
      jobDate: "2026-09-24T15:00",
      contactId: "c1",
      client: "Ronda Cook",
      clientCompany: "Austin State Supported Living Center",
      units: 10,
      price: 4965.7,
      cost: 2710,
      profit: 2255.7,
      margin: 45.43,
      servicePlan: false,
      soldBy: [],
    },
  ],
  pagination: { page: 1, pageSize: 50, total: 1, pages: 1, from: 1, to: 1 },
  money: true,
  ...over,
});

const lastParams = () => new URLSearchParams(hooks.useItemsReport.mock.lastCall![0] as string);

beforeEach(() => {
  perms.granted = new Set(["reports.view", "financials.view"]);
  hooks.useItemsReport.mockReset();
  hooks.useItemsReport.mockImplementation(() => ({ data: pageOf([row(), row({ key: "p-16995", number: 16995, name: "Labor - Painting", model: undefined, category: undefined, type: "product" })]), isFetching: false }));
  hooks.useItemsReportJobs.mockReset();
  hooks.useItemsReportJobs.mockImplementation(() => ({ data: jobsOf() }));
  download.mockReset();
});

describe("ItemsReportPage", () => {
  it("opens as Workiz does: This month, newest items first, 50 rows", () => {
    render(<Page today="2026-09-29" />);
    expect(Object.fromEntries(lastParams())).toEqual({
      from: "2026-09-01",
      to: "2026-09-29",
      sort: "number",
      dir: "desc",
      page: "1",
      pageSize: "50",
    });
    expect(screen.getByRole("button", { name: /^Date range/ })).toHaveTextContent("This month");
    expect(screen.getByRole("combobox", { name: "Rows per page" })).toHaveValue("50");
  });

  it("shows Workiz's columns, the bold Total first — rounded, never the float — and each item with its number and type", () => {
    render(<Page today="2026-09-29" />);
    for (const h of ["Item", "Model #", "Units", "Category", "Price", "Cost", "Profit", "Jobs"]) {
      expect(screen.getByRole("button", { name: `Sort by ${h}` })).toBeInTheDocument();
    }
    const total = screen.getByRole("row", { name: "Total" });
    expect(within(total).getByText("6,597.85")).toBeInTheDocument();
    expect(within(total).getByText("$678,418.94")).toBeInTheDocument();
    expect(within(total).getByText("90.25% margin")).toBeInTheDocument();
    expect(screen.getByText("#17011 - product")).toBeInTheDocument();
    expect(screen.getByText("TPHdc (SLK-17011)")).toBeInTheDocument();
    expect(screen.getAllByText("$4,965.70").length).toBeGreaterThan(0);
    expect(screen.getAllByText("45.43% margin").length).toBeGreaterThan(0);
  });

  it("▸ opens the jobs that used the item, over the same period", async () => {
    const user = userEvent.setup();
    render(<Page today="2026-09-29" />);
    await user.click(screen.getByRole("button", { name: /Show the jobs of Norton/ }));
    const params = new URLSearchParams(hooks.useItemsReportJobs.mock.lastCall![0] as string);
    expect(params.get("item")).toBe("p-17011");
    expect(params.get("from")).toBe("2026-09-01");
    const jobs = screen.getByLabelText(/Jobs of Norton/);
    expect(within(jobs).getByRole("link", { name: "Job #NII265" })).toHaveAttribute("href", "/deals/d1");
    expect(within(jobs).getByText("Ronda Cook")).toBeInTheDocument();
    expect(within(jobs).getByText("Austin State Supported Living Center")).toBeInTheDocument();
    expect(within(jobs).getByText("Thu Sep 24, 2026 03:00 pm")).toBeInTheDocument();
    expect(within(jobs).getByText("Showing 1 to 1 of 1 results")).toBeInTheDocument();
    expect(within(jobs).getByText("Page 1 of 1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Hide the jobs of Norton/ }));
    expect(screen.queryByLabelText(/Jobs of Norton/)).toBeNull();
  });

  it("the filter offers Workiz's four groups and narrows the report", async () => {
    const user = userEvent.setup();
    render(<Page today="2026-09-29" />);
    await user.click(screen.getByRole("button", { name: "Filter results" }));
    for (const g of ["Item type", "Job type", "Category", "Sold by"]) expect(screen.getByRole("region", { name: g })).toBeInTheDocument();
    const types = screen.getByRole("region", { name: "Item type" });
    expect(within(types).getAllByRole("checkbox").map((c) => c.textContent)).toEqual(["Product", "Service", "Hours", "Expense", "Equipment", "Warranty"]);
    await user.click(within(types).getByRole("checkbox", { name: "Service" }));
    await user.click(within(screen.getByRole("region", { name: "Category" })).getByRole("checkbox", { name: "Keys & Remotes" }));
    await user.click(within(screen.getByRole("region", { name: "Sold by" })).getByRole("checkbox", { name: "Betty Manager" }));
    expect(lastParams().get("type")).toBe("service");
    expect(lastParams().getAll("category")).toEqual(["Keys & Remotes"]);
    expect(lastParams().get("soldBy")).toBe("u1");
  });


  // The owner, 2026-10-08: "why two windows to pick the time?" — one period control.
  it("picks the period from one control, not a list beside a calendar", () => {
    render(<Page today="2026-09-29" />);
    expect(screen.queryByRole("combobox", { name: "Date preset" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Days/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Date range/ })).toHaveLength(1);
  });

  it("sorts on the server; Last 3 months is there", async () => {
    const user = userEvent.setup();
    render(<Page today="2026-09-29" />);
    await user.click(screen.getByRole("button", { name: "Sort by Units" }));
    expect(lastParams().get("sort")).toBe("units");
    expect(lastParams().get("dir")).toBe("desc");
    await user.click(screen.getByRole("button", { name: /^Date range/ }));
    await user.click(screen.getByRole("button", { name: "Last 3 months" }));
    expect(lastParams().get("from")).toBe("2026-06-01");
    expect(lastParams().get("to")).toBe("2026-08-31");
  });

  it("exports the CSV of the same query", async () => {
    const user = userEvent.setup();
    download.mockResolvedValue(new Blob(["Item\r\n"]));
    render(<Page today="2026-09-29" />);
    await user.click(screen.getByRole("button", { name: /Export/ }));
    const params = new URLSearchParams(download.mock.lastCall![0] as string);
    expect(params.get("from")).toBe("2026-09-01");
    expect(params.get("page")).toBeNull();
  });

  it("without financials.view the money columns are not drawn", () => {
    perms.granted = new Set(["reports.view"]);
    hooks.useItemsReport.mockImplementation(() => ({
      data: pageOf([row({ price: undefined, cost: undefined, profit: undefined, margin: undefined })], {
        money: false,
        totals: { items: 1, units: 10 },
      }),
      isFetching: false,
    }));
    render(<Page today="2026-09-29" />);
    expect(screen.queryByRole("button", { name: "Sort by Price" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sort by Profit" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sort by Units" })).toBeInTheDocument();
  });

  it("refuses a user without reports and asks nothing", () => {
    perms.granted = new Set();
    render(<Page today="2026-09-29" />);
    expect(screen.getByText(/no access/i)).toBeInTheDocument();
    expect(hooks.useItemsReport.mock.lastCall![1]).toBe(false);
  });
});
