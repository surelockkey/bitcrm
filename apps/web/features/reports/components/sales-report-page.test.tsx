import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobSuperStatus, type SalesReportPage, type SalesReportRow } from "@bitcrm/types";
import { SalesReportPage as Page } from "./sales-report-page";

const perms = vi.hoisted(() => ({ granted: new Set<string>() }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => (resource: string, action = "view") => !perms.granted.has(`${resource}.${action}`),
  usePermissions: () => ({
    can: (resource: string, action = "view") => perms.granted.has(`${resource}.${action}`),
    isLoading: false,
  }),
}));

const hooks = vi.hoisted(() => ({
  useSalesReport: vi.fn(),
  settings: { columns: [] as string[], by: "scheduled" },
  save: vi.fn(),
}));
vi.mock("../sales/hooks", () => ({
  useSalesReport: hooks.useSalesReport,
  useSalesReportSettings: () => ({ data: hooks.settings, isFetched: true }),
  useSaveSalesReportSettings: () => ({ mutate: hooks.save, isPending: false }),
}));
const download = vi.hoisted(() => vi.fn());
vi.mock("../sales/api", () => ({ downloadSalesReportCsv: download }));

vi.mock("@/features/deals/hooks", () => ({
  useUserMap: () => ({
    map: new Map(),
    users: [
      { id: "u-tech", firstName: "Sam", lastName: "Tech" },
      { id: "u-disp", firstName: "Tess", lastName: "Disp" },
    ],
    isLoading: false,
  }),
}));
vi.mock("@/features/technicians/hooks", () => ({ useAllTechnicians: () => ({ profiles: [{ userId: "u-tech" }], isLoading: false }) }));
vi.mock("@/features/job-types/hooks", () => ({ useJobTypes: () => ({ data: [{ id: "jt1", name: "Car key" }] }) }));
vi.mock("@/features/job-sources/hooks", () => ({ useJobSources: () => ({ data: [{ id: "s1", name: "GMB" }] }) }));
vi.mock("@/features/service-areas/hooks", () => ({ useServiceAreas: () => ({ data: [{ id: "sa1", name: "SURE LOCK CT" }] }) }));
// The Jobs report page is imported for its pager; its own catalogs are not used here.
vi.mock("@/features/job-statuses/hooks", () => ({ useJobStatuses: () => ({ data: [] }) }));
vi.mock("@/features/job-tags/hooks", () => ({ useJobTags: () => ({ data: [] }) }));
vi.mock("@/features/external-companies/hooks", () => ({ useExternalCompanies: () => ({ data: [] }) }));

const row = (over: Partial<SalesReportRow> = {}): SalesReportRow => ({
  id: "d1",
  jobNumber: "LKYZTX",
  jobSerial: 374554,
  contactId: "c1",
  client: "Brian Sanford",
  email: "brian@example.com",
  createdAt: "2026-09-27T20:55:10.000Z",
  scheduled: "2026-09-27T15:15",
  end: "2026-09-27T18:57",
  superStatus: JobSuperStatus.DONE,
  status: "Done",
  jobTypeId: "jt1",
  type: "House Lockout",
  techIds: ["u-tech"],
  tech: ["Sam Tech"],
  sourceId: "s1",
  source: "GMB",
  invoiceId: "d1",
  serviceAreaId: "sa1",
  serviceArea: "SURE LOCK AZ",
  total: 267,
  subtotal: 267,
  itemCost: 0,
  laborCost: 0,
  cardExpenses: 0,
  techExpenses: 34,
  paid: 267,
  due: 0,
  tax: 0,
  profit: 233,
  tip: 0,
  margin: 87.27,
  ...over,
});

const pageOf = (rows: SalesReportRow[], over: Partial<SalesReportPage> = {}): SalesReportPage => ({
  rows,
  totals: { jobs: rows.length, total: 660283.62, itemCost: 89121.79, laborCost: 0, techExpenses: 19974.38, paid: 388025.23, due: 272258.39, tax: 19145.63, profit: 532041.83, tip: 2899.77, subtotal: 630938.02, cardExpenses: 0, margin: 80.58 },
  chart: [
    { day: "2026-09-01", sales: 11250.47, profit: 10264.26 },
    { day: "2026-09-02", sales: 21318.12, profit: 17913.01 },
  ],
  pagination: { page: 1, pageSize: 10, total: 1023, pages: 103, from: 1, to: rows.length },
  window: { by: "scheduled", from: "2026-09-01", to: "2026-09-30" },
  sort: { column: "jobNumber", dir: "desc" },
  money: true,
  ...over,
});

const VISIBLE = [
  "jobNumber", "client", "created", "scheduled", "end", "status", "type", "total", "itemCost", "laborCost",
  "techExpenses", "paid", "due", "tax", "profit", "tip", "source", "invoice", "serviceArea",
];

/** The report grid — not the chart's screen-reader table. */
const grid = () =>
  screen.getAllByRole("table").find((t) => within(t).queryAllByRole("columnheader").some((h) => h.getAttribute("aria-label") === "Job ID"))!;

const lastParams = () => Object.fromEntries(new URLSearchParams(hooks.useSalesReport.mock.lastCall![0] as string));

beforeEach(() => {
  perms.granted = new Set(["reports.view", "reports.edit", "financials.view"]);
  hooks.settings = { columns: [...VISIBLE], by: "scheduled" };
  hooks.useSalesReport.mockReset();
  hooks.useSalesReport.mockImplementation(() => ({ data: pageOf([row(), row({ id: "d2", jobNumber: "RK1Q8O", email: undefined, phone: "+14753139051", due: -886.41 })]), isFetching: false }));
  hooks.save.mockReset();
  download.mockReset();
  try {
    localStorage.clear();
  } catch {
    /* jsdom */
  }
});

describe("SalesReportPage", () => {
  it("opens as Workiz does: this month, By: Job date, Job ID newest first, 10 rows", () => {
    render(<Page today="2026-09-30" />);
    expect(lastParams()).toEqual({
      by: "scheduled",
      from: "2026-09-01",
      to: "2026-09-30",
      sort: "jobNumber",
      dir: "desc",
      page: "1",
      pageSize: "10",
    });
    expect(screen.getByRole("combobox", { name: "By" })).toHaveValue("scheduled");
    expect(screen.getByRole("combobox", { name: "Rows per page" })).toHaveValue("10");
  });

  it("shows the account's columns in Workiz's order, the bold Total row first, then the jobs", () => {
    render(<Page today="2026-09-30" />);
    const table = grid();
    const headers = within(table).getAllByRole("columnheader").map((h) => h.getAttribute("aria-label"));
    expect(headers).toEqual([
      "Job ID", "Client", "Created", "Scheduled", "End", "Status", "Job type", "Total", "Item cost", "Labor cost",
      "Tech expenses", "Paid amount", "Due", "Tax", "Profit", "Tip", "Source", "Invoice", "Metro",
    ]);
    const rows = within(table).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Total:");
    expect(rows[1]).toHaveTextContent("$660,283.62");
    expect(rows[1]).toHaveTextContent("80.58% margin");
    expect(rows[2]).toHaveTextContent("LKYZTX");
    expect(rows[2]).toHaveTextContent("brian@example.com");
    expect(rows[2]).toHaveTextContent("Sun Sep 27, 2026 03:15 pm");
    expect(rows[2]).toHaveTextContent("87.27% margin");
    // No email: the phone under the name; an overpaid job's Due below zero.
    expect(rows[3]).toHaveTextContent("(475) 313-9051");
    expect(rows[3]).toHaveTextContent("-$886.41");
    expect(screen.getByText("Showing 1 to 2 of 1,023 results")).toBeInTheDocument();
  });

  it("draws the Profit / Sales chart per day", () => {
    render(<Page today="2026-09-30" />);
    expect(screen.getByRole("list", { name: "Legend" })).toHaveTextContent("ProfitSales");
    expect(screen.getByRole("table", { name: "Sales and profit per day" })).toHaveTextContent("09/01/26");
  });

  it("asks again on another By, preset, page size and sort", async () => {
    render(<Page today="2026-09-30" />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "By" }), "end");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Date preset" }), "last_month");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Rows per page" }), "100");
    await userEvent.click(screen.getByRole("button", { name: "Sort by Total" }));
    expect(lastParams()).toMatchObject({ by: "end", from: "2026-08-01", to: "2026-08-31", pageSize: "100", sort: "total", dir: "desc" });
    expect(localStorage.getItem("bitcrm.sales-report.by")).toBe("end");
  });

  it("offers Workiz's six filter groups; a status clicked in a cell filters by it", async () => {
    render(<Page today="2026-09-30" />);
    await userEvent.click(screen.getByRole("button", { name: "Filter results" }));
    const groups = screen.getByRole("group", { name: "Filter groups" });
    expect(within(groups).getAllByRole("region").map((g) => g.getAttribute("aria-label"))).toEqual([
      "Status", "Team", "Job type", "Payment status", "Source", "Service areas",
    ]);
    const status = within(groups).getByRole("region", { name: "Status" });
    expect(within(status).getAllByRole("checkbox").map((c) => c.textContent)).not.toContain("Canceled");
    await userEvent.click(within(within(groups).getByRole("region", { name: "Payment status" })).getByRole("checkbox", { name: "Partly paid" }));
    expect(lastParams().paymentStatus).toBe("partly_paid");
    await userEvent.keyboard("{Escape}");
    const first = within(grid()).getAllByRole("row")[2];
    await userEvent.click(within(first).getByRole("button", { name: "Done" }));
    expect(lastParams().status).toBe("done");
  });

  it("exports the same query with the visible columns", async () => {
    download.mockResolvedValue(new Blob(["Job ID\r\n"]));
    render(<Page today="2026-09-30" />);
    await userEvent.click(screen.getByRole("button", { name: /Export/ }));
    const params = Object.fromEntries(new URLSearchParams(download.mock.lastCall![0] as string));
    expect(params).toMatchObject({ by: "scheduled", from: "2026-09-01", to: "2026-09-30", sort: "jobNumber" });
    expect(params.columns?.split(",")).toEqual(VISIBLE);
    expect(params.page).toBeUndefined();
  });

  it("saves the visible fields for the account", async () => {
    render(<Page today="2026-09-30" />);
    await userEvent.click(screen.getByRole("button", { name: /Fields/ }));
    const panel = screen.getByRole("dialog", { name: "Visible fields" });
    await userEvent.click(within(panel).getByLabelText("Tech"));
    await userEvent.click(within(panel).getByLabelText("Tip"));
    await userEvent.click(within(panel).getByRole("button", { name: "Save fields" }));
    const saved = hooks.save.mock.lastCall![0].columns as string[];
    expect(saved).toContain("tech");
    expect(saved).not.toContain("tip");
    expect(saved.indexOf("tech")).toBe(saved.indexOf("type") + 1);
  });

  it("without financials.view: no amounts, no chart, no amount in the Fields panel", async () => {
    perms.granted.delete("financials.view");
    hooks.useSalesReport.mockImplementation(() => ({
      data: pageOf([row({ total: undefined, profit: undefined, margin: undefined })], { money: false, totals: { jobs: 1 }, chart: [] }),
      isFetching: false,
    }));
    render(<Page today="2026-09-30" />);
    expect(screen.queryByRole("columnheader", { name: "Total" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Legend" })).toBeNull();
    expect(screen.getByText(/Amounts are hidden/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Fields/ }));
    expect(within(screen.getByRole("dialog", { name: "Visible fields" })).queryByLabelText("Profit")).toBeNull();
  });

  it("is closed to anyone without the reports permission", () => {
    perms.granted = new Set(["deals.view"]);
    render(<Page today="2026-09-30" />);
    expect(screen.getByText(/no access/i)).toBeInTheDocument();
    expect(hooks.useSalesReport.mock.lastCall![1]).toBe(false);
  });
});
