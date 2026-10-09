import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CommissionReport, CommissionReportRow, CommissionReportTotals } from "@bitcrm/types";
import { COMMISSION_REPORT_TOTAL_KEYS } from "@bitcrm/types";
import { CommissionsPage } from "./commissions-page";

const perms = vi.hoisted(() => ({ granted: new Set<string>() }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => (resource: string, action = "view") => !perms.granted.has(`${resource}.${action}`),
  usePermissions: () => ({ can: (resource: string, action = "view") => perms.granted.has(`${resource}.${action}`), isLoading: false }),
}));

const { useCommissionReport, downloadCommissionCsv, reloadCommissionReport } = vi.hoisted(() => ({
  useCommissionReport: vi.fn(),
  downloadCommissionCsv: vi.fn(async () => undefined),
  reloadCommissionReport: vi.fn(async () => undefined),
}));
vi.mock("../commissions/hooks", () => ({ useCommissionReport, downloadCommissionCsv, reloadCommissionReport }));
vi.mock("@tanstack/react-query", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({}),
}));
vi.mock("@/features/job-types/hooks", () => ({ useJobTypes: () => ({ data: [{ id: "jt-1", name: "Lockout" }] }) }));
vi.mock("@/features/service-areas/hooks", () => ({ useServiceAreas: () => ({ data: [{ id: "area-1", name: "SURE LOCK CT" }] }) }));
vi.mock("@/features/job-sources/hooks", () => ({ useJobSources: () => ({ data: [{ id: "src-1", name: "Google" }] }) }));
vi.mock("@/features/external-companies/hooks", () => ({
  useExternalCompanies: () => ({ data: [{ id: "ext-1", name: "Partner LLC" }] }),
}));
vi.mock("@/features/deals/hooks", () => ({
  useUserMap: () => ({
    users: [
      { id: "moshe", firstName: "Moshe", lastName: "Szender" },
      { id: "ann", firstName: "Ann", lastName: "Office" },
    ],
    map: new Map(),
    isLoading: false,
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const totals = (over: Partial<Record<string, number>> = {}): CommissionReportTotals =>
  Object.fromEntries(COMMISSION_REPORT_TOTAL_KEYS.map((k) => [k, { amount: over[k] ?? 0, jobs: over[k] ? 1 : 0 }])) as CommissionReportTotals;

const row = (over: Partial<CommissionReportRow> = {}): CommissionReportRow => ({
  dealId: "deal-1",
  dealNumber: "TGQ6NS",
  techId: "moshe",
  techName: "Moshe Szender",
  techIds: ["moshe"],
  createdAt: "2026-07-28T15:48:08.000Z",
  scheduledDate: "2026-09-02",
  scheduledTimeSlot: "18:00-19:00",
  closedDate: "2026-09-02",
  closedTime: "19:00",
  jobTypeName: "(A-1) Door Service",
  address: "215 Main St , 06851",
  clientName: "Jane Client",
  total: 197.17,
  cash: 0,
  credit: 197.17,
  billing: 0,
  check: 0,
  rate: 50,
  rateUnit: "%",
  rateSource: "tech",
  tip: 0,
  parts: 82.74,
  companyParts: 0,
  techProfit: 48.63,
  externalCompanyProfit: 0,
  companyProfit: 54.37,
  tax: 11.43,
  cashByExternal: 0,
  creditByExternal: 0,
  billingByExternal: 0,
  checkByExternal: 0,
  balance: 131.37,
  source: "workiz",
  ...over,
});

const report = (over: Partial<CommissionReport> = {}): CommissionReport => ({
  window: { by: "closed", from: "2026-09-29", to: "2026-09-29" },
  mode: "standard",
  count: 1,
  offset: 0,
  limit: 50,
  rows: [row()],
  totals: totals({ total: 197.17, credit: 197.17, techProfit: 48.63, companyProfit: 54.37, tax: 11.43, parts: 82.74, balance: 131.37 }),
  techs: [
    { techId: "moshe", techName: "Moshe Szender", jobs: 14, total: 26354.78, techProfit: 7903.24, parts: 8344.57, companyParts: 0, tip: 0, tax: 1543.53, balance: 15026.35 },
  ],
  externalCompanies: [],
  computedRows: 0,
  truncated: false,
  warnings: [],
  money: true,
  ...over,
});

const lastFilters = () => useCommissionReport.mock.calls.at(-1)?.[0];
const grid = () => screen.getByRole("table", { name: "Commissions" });
const headerRow = () => within(grid()).getAllByRole("row")[0];
const pick = async (combobox: string, option: string) => {
  await userEvent.click(screen.getByRole("combobox", { name: combobox }));
  await userEvent.click(screen.getByRole("option", { name: option }));
};

beforeEach(() => {
  perms.granted = new Set(["commission.view", "financials.view"]);
  useCommissionReport.mockReset();
  useCommissionReport.mockImplementation(() => ({ data: report(), error: null }));
  downloadCommissionCsv.mockClear();
  reloadCommissionReport.mockClear();
  window.localStorage.clear();
});

describe("CommissionsPage — Workiz's Finance Reporting", () => {
  it("opens on Today, by Closed, in the Standard report, in Workiz's own order (creation, nothing marked)", () => {
    render(<CommissionsPage today="2026-09-29" />);
    expect(lastFilters()).toMatchObject({ from: "2026-09-29", to: "2026-09-29", by: "closed", mode: "standard", sort: "createdAt", dir: "asc", offset: 0, limit: 50 });
    for (const th of within(headerRow()).getAllByRole("columnheader")) expect(th).toHaveAttribute("aria-sort", "none");
    // No page heading: Workiz names the report in the breadcrumb only.
    expect(screen.getByRole("heading", { level: 1, name: "Commissions" })).toHaveClass("sr-only");
  });

  it("the Totals row sits in the head under the names, the jobs below, both printed as Workiz prints them", () => {
    render(<CommissionsPage today="2026-09-29" />);
    const rows = within(grid()).getAllByRole("row");
    expect(rows[0]).toHaveTextContent(/^Job IdTechScheduledClosedJob TypeAddressTotal/);
    expect(rows[1]).toHaveTextContent(/^Totals:1/);
    expect(within(rows[1]).getAllByRole("cell")[6]).toHaveTextContent("197.17");
    expect(rows[2]).toHaveTextContent("TGQ6NS");
    expect(rows[2]).toHaveTextContent("09/02/2026 07:00 PM");
    expect(rows[2]).toHaveTextContent("50%");
    expect(within(rows[2]).getByRole("link", { name: "TGQ6NS" })).toHaveAttribute("href", "/deals/deal-1");
    expect(screen.getByText("Showing 1 to 1 of 1 entries")).toBeInTheDocument();
  });

  it("Total Profits and Total by type under the grid, the numbers as they are", () => {
    render(<CommissionsPage today="2026-09-29" />);
    const profits = screen.getByRole("table", { name: "Total Profits" });
    expect(within(profits).getAllByRole("row").map((r) => r.textContent)).toEqual([
      "Profit ForAmount",
      "external company profit0",
      "company profit54.37",
      "tech profit48.63",
    ]);
    const byType = screen.getByRole("table", { name: "Total by type" });
    expect(within(byType).getByText("credit").closest("tr")).toHaveTextContent("credit197.171");
  });

  it("picks the period from Workiz's box, its presets in its spelling", async () => {
    render(<CommissionsPage today="2026-09-29" />);
    expect(screen.getAllByRole("button", { name: /^Date range/ })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: /^Date range/ }));
    expect(screen.getByRole("menuitem", { name: "This week(Sun - Today)" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "Last week (Mon - Sun)" }));
    expect(lastFilters()).toMatchObject({ from: "2026-09-21", to: "2026-09-27" });
  });

  it("the Tech Report without a technician lists every job in the Tech columns; a technician narrows it", async () => {
    render(<CommissionsPage today="2026-09-29" />);
    await pick("Report mode", "Tech Report");
    expect(lastFilters()).toMatchObject({ mode: "standard", techId: undefined });
    expect(headerRow()).toHaveTextContent("Balance Tech");
    expect(headerRow()).toHaveTextContent("Created");
    expect(headerRow()).not.toHaveTextContent("Company Profit");
    // Workiz's Tech mode has no Ad Group (its Settlement filter sits there).
    expect(screen.queryByRole("combobox", { name: "Ad group" })).toBeNull();
    await pick("Technician", "Moshe Szender [14]");
    expect(lastFilters()).toMatchObject({ mode: "tech", techId: "moshe" });
    expect(within(screen.getByRole("table", { name: "Total Profits" })).getAllByRole("row")[1]).toHaveTextContent("tech profit48.63");
  });

  it("the technician list is every user, with “[N]” after those with jobs in the period", async () => {
    render(<CommissionsPage today="2026-09-29" />);
    await userEvent.click(screen.getByRole("combobox", { name: "Technician" }));
    const names = within(screen.getByRole("listbox", { name: "Technician" }))
      .getAllByRole("option")
      .map((o) => o.textContent?.replace(/\s+/g, " "));
    expect(names).toEqual(["Select Technician", "Ann Office", "Moshe Szender [14]"]);
  });

  it("switches By Time and sorts by a header: ascending first, then descending", async () => {
    render(<CommissionsPage today="2026-09-29" />);
    await userEvent.click(screen.getByRole("radio", { name: "Created" }));
    expect(lastFilters()).toMatchObject({ by: "created" });
    await userEvent.click(within(headerRow()).getByRole("button", { name: "Total" }));
    expect(lastFilters()).toMatchObject({ sort: "total", dir: "asc" });
    await userEvent.click(within(headerRow()).getByRole("button", { name: /Total/ }));
    expect(lastFilters()).toMatchObject({ sort: "total", dir: "desc" });
  });

  it("External Company and Ad Group exclude each other", async () => {
    render(<CommissionsPage today="2026-09-29" />);
    await pick("External company", "External Only");
    expect(lastFilters()).toMatchObject({ externalCompanyId: "only" });
    expect(screen.getByRole("combobox", { name: "Ad group" })).toBeDisabled();
  });

  it("searches from the third character", async () => {
    render(<CommissionsPage today="2026-09-29" />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search" }), "TG");
    await new Promise((r) => setTimeout(r, 350));
    expect(lastFilters()?.q).toBeUndefined();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search" }), "Q");
    await vi.waitFor(() => expect(lastFilters()?.q).toBe("TGQ"));
  });

  it("Fields opens Workiz's switch panel; a switch hides a column and is remembered; ✕ closes it", async () => {
    render(<CommissionsPage today="2026-09-29" />);
    expect(headerRow()).toHaveTextContent("Client");
    const fields = screen.getByRole("button", { name: "Fields" });
    await userEvent.click(fields);
    expect(fields).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(screen.getByRole("switch", { name: "Client" }));
    expect(headerRow()).not.toHaveTextContent("Client");
    expect(JSON.parse(window.localStorage.getItem("bitcrm.commissions.fields") ?? "{}")).toEqual({ standard: { clientName: false } });
    await userEvent.click(screen.getByRole("button", { name: "Hide fields" }));
    expect(screen.queryByRole("group", { name: "Fields" })).toBeNull();
  });

  it("pages with Previous / Next and changes the page size", async () => {
    useCommissionReport.mockImplementation(() => ({ data: report({ count: 244 }), error: null }));
    render(<CommissionsPage today="2026-09-29" />);
    expect(screen.getByText("Showing 1 to 50 of 244 entries (filtered from 50 total entries)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(lastFilters()).toMatchObject({ offset: 50, limit: 50 });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Show entries" }), "100");
    expect(lastFilters()).toMatchObject({ offset: 0, limit: 100 });
  });

  it("Reload Results re-reads the period", async () => {
    render(<CommissionsPage today="2026-09-29" />);
    await userEvent.click(screen.getByRole("button", { name: "Reload Results" }));
    expect(reloadCommissionReport).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ from: "2026-09-29", mode: "standard" }));
  });

  it("exports the whole filtered set", async () => {
    render(<CommissionsPage today="2026-09-29" />);
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(downloadCommissionCsv).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-09-29", mode: "standard" }));
  });

  it("an empty period: Totals:0, No Records Found, and the summaries with their names only", () => {
    useCommissionReport.mockImplementation(() => ({ data: report({ count: 0, rows: [], totals: totals() }), error: null }));
    render(<CommissionsPage today="2026-09-29" />);
    expect(within(grid()).getAllByRole("row")[1]).toHaveTextContent(/^Totals:0$/);
    expect(screen.getByRole("cell", { name: "No Records Found" })).toBeInTheDocument();
    expect(screen.getByText("Showing 0 to 0 of 0 entries")).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "Total Profits" })).getAllByRole("row")).toHaveLength(1);
  });

  it("without financials.view: the jobs, no amounts, no rate, no summaries", () => {
    perms.granted = new Set(["commission.view"]);
    useCommissionReport.mockImplementation(() => ({ data: report({ money: false }), error: null }));
    render(<CommissionsPage today="2026-09-29" />);
    expect(headerRow()).toHaveTextContent(/^Job IdTechScheduledClosedJob TypeAddressClient$/);
    expect(within(grid()).getAllByRole("row")[1]).toHaveTextContent(/^Totals:1$/);
    expect(screen.queryByRole("table", { name: "Total Profits" })).toBeNull();
    expect(screen.queryByRole("table", { name: "Total by type" })).toBeNull();
  });

  it("says when figures are incomplete", () => {
    useCommissionReport.mockImplementation(() => ({ data: report({ warnings: ["Payments could not be read for 2 job(s)"] }), error: null }));
    render(<CommissionsPage today="2026-09-29" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Payments could not be read/);
  });

  it("is closed without commission.view, and does not ask for the report", () => {
    perms.granted = new Set(["reports.view"]);
    render(<CommissionsPage today="2026-09-29" />);
    expect(screen.getByText(/no access/i)).toBeInTheDocument();
    expect(lastFilters()).toBeNull();
  });
});
