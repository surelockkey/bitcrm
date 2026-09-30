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

const { useCommissionReport, downloadCommissionCsv } = vi.hoisted(() => ({
  useCommissionReport: vi.fn(),
  downloadCommissionCsv: vi.fn(async () => undefined),
}));
vi.mock("../commissions/hooks", () => ({ useCommissionReport, downloadCommissionCsv }));
vi.mock("@/features/job-types/hooks", () => ({ useJobTypes: () => ({ data: [{ id: "jt-1", name: "Lockout" }] }) }));
vi.mock("@/features/service-areas/hooks", () => ({ useServiceAreas: () => ({ data: [{ id: "area-1", name: "SURE LOCK CT" }] }) }));
vi.mock("@/features/job-sources/hooks", () => ({ useJobSources: () => ({ data: [{ id: "src-1", name: "Google" }] }) }));
vi.mock("@/features/external-companies/hooks", () => ({
  useExternalCompanies: () => ({ data: [{ id: "ext-1", name: "Partner LLC" }] }),
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
  address: "215 Main St, Norwalk",
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
  ...over,
});

const lastFilters = () => useCommissionReport.mock.calls.at(-1)?.[0];

beforeEach(() => {
  perms.granted = new Set(["commission.view"]);
  useCommissionReport.mockReset();
  useCommissionReport.mockImplementation(() => ({ data: report(), error: null }));
  downloadCommissionCsv.mockClear();
  window.localStorage.clear();
});

describe("CommissionsPage", () => {
  it("opens on Today, by Closed, in the Standard report — as Workiz does", () => {
    render(<CommissionsPage today="2026-09-29" />);
    expect(lastFilters()).toMatchObject({ from: "2026-09-29", to: "2026-09-29", by: "closed", mode: "standard", offset: 0, limit: 50 });
  });

  it("shows the Totals row first, then the jobs, and the two summaries", () => {
    render(<CommissionsPage today="2026-09-29" />);
    const table = screen.getByRole("table", { name: "Commissions" });
    const rows = within(table).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Totals:1");
    expect(rows[1]).toHaveTextContent("197.17");
    expect(rows[2]).toHaveTextContent("TGQ6NS");
    expect(rows[2]).toHaveTextContent("Moshe Szender");
    expect(rows[2]).toHaveTextContent("50%");
    expect(rows[2]).toHaveTextContent("48.63");
    expect(within(rows[2]).getByRole("link", { name: "TGQ6NS" })).toHaveAttribute("href", "/deals/deal-1");
    expect(within(screen.getByRole("table", { name: "Total Profits" })).getByText("company profit").parentElement).toHaveTextContent("54.37");
    expect(within(screen.getByRole("table", { name: "Total by type" })).getByText("credit").parentElement).toHaveTextContent("197.17");
  });

  it("the weekly settlement: Last week (Mon – Sun), Tech Report, pick the technician", async () => {
    render(<CommissionsPage today="2026-09-29" />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Date preset" }), "last_week_mon");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Report mode" }), "tech");
    // No technician yet: the period's technicians to pick from (the Standard slice).
    expect(lastFilters()).toMatchObject({ from: "2026-09-21", to: "2026-09-27", mode: "standard" });
    const picker = screen.getByRole("table", { name: "Technicians" });
    expect(picker).toHaveTextContent("15,026.35");
    await userEvent.click(within(picker).getByRole("button", { name: "Moshe Szender" }));
    expect(lastFilters()).toMatchObject({ mode: "tech", techId: "moshe", from: "2026-09-21", to: "2026-09-27" });
    const header = within(screen.getByRole("table", { name: "Commissions" })).getAllByRole("row")[0];
    expect(header).toHaveTextContent("Balance Tech");
    expect(header).not.toHaveTextContent("Company Profit");
  });

  it("the technician list carries each one's job count, as Workiz's “[N]”", () => {
    render(<CommissionsPage today="2026-09-29" />);
    expect(screen.getByRole("option", { name: "Moshe Szender [14]" })).toBeInTheDocument();
  });

  it("switches By Time and sorts by a column", async () => {
    render(<CommissionsPage today="2026-09-29" />);
    await userEvent.click(screen.getByRole("radio", { name: "Created" }));
    expect(lastFilters()).toMatchObject({ by: "created" });
    await userEvent.click(screen.getByRole("button", { name: "Sort by Total" }));
    expect(lastFilters()).toMatchObject({ sort: "total", dir: "asc" });
    await userEvent.click(screen.getByRole("button", { name: "Sort by Total" }));
    expect(lastFilters()).toMatchObject({ sort: "total", dir: "desc" });
  });

  it("External Company and Ad Group exclude each other", async () => {
    render(<CommissionsPage today="2026-09-29" />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "External company" }), "only");
    expect(lastFilters()).toMatchObject({ externalCompanyId: "only" });
    expect(screen.getByRole("combobox", { name: "Ad group" })).toBeDisabled();
  });

  it("searches from the third character", async () => {
    render(<CommissionsPage today="2026-09-29" />);
    await userEvent.type(screen.getByRole("textbox", { name: "Search" }), "TG");
    await new Promise((r) => setTimeout(r, 350));
    expect(lastFilters()?.q).toBeUndefined();
    await userEvent.type(screen.getByRole("textbox", { name: "Search" }), "Q");
    await vi.waitFor(() => expect(lastFilters()?.q).toBe("TGQ"));
  });

  it("Fields hides and shows columns, and remembers the choice", async () => {
    render(<CommissionsPage today="2026-09-29" />);
    await userEvent.click(screen.getByRole("button", { name: "Fields" }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Client" }));
    await userEvent.keyboard("{Escape}");
    expect(within(screen.getByRole("table", { name: "Commissions" })).getAllByRole("row")[0]).toHaveTextContent("Client");
    expect(JSON.parse(window.localStorage.getItem("bitcrm.commissions.fields") ?? "{}")).toEqual({ standard: { clientName: true } });
  });

  it("exports the whole filtered set", async () => {
    render(<CommissionsPage today="2026-09-29" />);
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(downloadCommissionCsv).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-09-29", mode: "standard" }));
  });

  it("says when figures are incomplete", () => {
    useCommissionReport.mockImplementation(() => ({ data: report({ warnings: ["Payments could not be read for 2 job(s)"] }), error: null }));
    render(<CommissionsPage today="2026-09-29" />);
    expect(screen.getByText("Some figures are incomplete")).toBeInTheDocument();
    expect(screen.getByText(/Payments could not be read/)).toBeInTheDocument();
  });

  it("is closed without commission.view, and does not ask for the report", () => {
    perms.granted = new Set(["reports.view"]);
    render(<CommissionsPage today="2026-09-29" />);
    expect(screen.getByText(/no access/i)).toBeInTheDocument();
    expect(lastFilters()).toBeNull();
  });
});
