import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { toast, perms } = vi.hoisted(() => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
  perms: { denied: new Set<string>() },
}));

vi.mock("sonner", () => ({ toast }));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: (r: string, a = "view") => !perms.denied.has(`${r}.${a}`) }),
  // This suite asserts refusals, so it mirrors `can` rather than declaring
  // nobody is ever refused.
  useDenied: () => (r: string, a = "view") => perms.denied.has(`${r}.${a}`),
}));

import { ReportsPage, REPORT_TILES } from "./reports-page";

/** Workiz → Reports → "Workiz reports", as it stands (2026-09-30): 23 tiles, row by row. */
const WORKIZ_ORDER = [
  "Jobs", "Performance Pay", "Sales",
  "Tips", "Job Statistics", "Leads Report",
  "Payments", "Expenses", "Activity",
  "Estimates", "Invoices", "Aging invoices",
  "Timesheets", "Items and services", "Website requests",
  "Tax", "Call Tracking", "Inventory Usage",
  "Franchise Report", "Tasks", "Equipment",
  "Service Plans", "Commissions (Legacy)",
];

/**
 * Where each report lives in BitCRM — on main or in its open PR (#83–#90;
 * Inventory Usage in `web/inventory-report`). Merging one of those must be
 * all it takes to turn its tile on.
 */
const ROUTES: Record<string, string> = {
  Jobs: "/reports/jobs",
  Sales: "/reports/sales", // #90
  "Job Statistics": "/reports/job-statistics",
  Payments: "/payments", // #83
  Activity: "/reports/activity", // #88
  Estimates: "/estimates",
  Invoices: "/invoices",
  "Aging invoices": "/reports/aging-invoices", // #87
  "Items and services": "/reports/items", // #89
  Tax: "/reports/tax", // #87
  "Call Tracking": "/reports/call-tracking", // #88
  "Inventory Usage": "/reports/inventory-usage", // web/inventory-report
  "Commissions (Legacy)": "/reports/commission", // #85
  Timesheets: "/reports/timesheets", // #94
  Tips: "/reports/tips", // in progress
};

/** Reports BitCRM has no page for and nobody is building. */
const NOT_IN_BITCRM = [
  "Performance Pay", "Leads Report", "Expenses",
  "Website requests", "Franchise Report", "Tasks", "Equipment", "Service Plans",
];

/** The report pages on main today. */
const ON_MAIN = ["/reports/jobs", "/reports/job-statistics", "/payments", "/estimates", "/invoices"];

const workizPanel = () => screen.getByRole("tabpanel", { name: "Workiz reports" });
/** The tiles' names in page order — links and "not yet" buttons alike. */
const tileNames = () =>
  [...workizPanel().querySelectorAll("a, button")].map((el) => el.querySelector("[data-slot=report-name]")?.textContent ?? "");

describe("ReportsPage", () => {
  beforeEach(() => {
    toast.info.mockReset();
    perms.denied = new Set();
  });

  it("shows Workiz's 23 report tiles, in Workiz's order, with Workiz's labels", () => {
    render(<ReportsPage built={ON_MAIN} />);

    expect(REPORT_TILES.map((t) => t.name)).toEqual(WORKIZ_ORDER);
    expect(tileNames()).toEqual(WORKIZ_ORDER);
  });

  it("points every report at its BitCRM page, the open PRs' pages included", () => {
    expect(Object.fromEntries(REPORT_TILES.filter((t) => t.href).map((t) => [t.name, t.href]))).toEqual(ROUTES);
    expect(REPORT_TILES.filter((t) => !t.href).map((t) => t.name)).toEqual(NOT_IN_BITCRM);
  });

  it("opens only the reports that are built; a report still in a PR says it's coming", async () => {
    render(<ReportsPage built={ON_MAIN} />);

    expect(screen.getByRole("link", { name: "Jobs" })).toHaveAttribute("href", "/reports/jobs");
    expect(screen.getByRole("link", { name: "Job Statistics" })).toHaveAttribute("href", "/reports/job-statistics");
    // Workiz opens these on the pages of the same name.
    expect(screen.getByRole("link", { name: "Estimates" })).toHaveAttribute("href", "/estimates");
    expect(screen.getByRole("link", { name: "Invoices" })).toHaveAttribute("href", "/invoices");
    expect(screen.getByRole("link", { name: "Payments" })).toHaveAttribute("href", "/payments");

    const sales = screen.getByRole("button", { name: /^Sales/ });
    expect(sales).toHaveAttribute("aria-disabled", "true");
    expect(sales).toHaveTextContent("Coming soon");
    expect(screen.queryByRole("link", { name: /Sales/ })).toBeNull();
    await userEvent.click(sales);
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("Sales"));
  });

  it("greys out the reports BitCRM doesn't have, and says so", async () => {
    render(<ReportsPage built={ON_MAIN} />);

    for (const name of NOT_IN_BITCRM) {
      const tile = screen.getByRole("button", { name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}`) });
      expect(tile).toHaveAttribute("aria-disabled", "true");
      expect(tile).toHaveTextContent("Not in BitCRM");
    }
    await userEvent.click(screen.getByRole("button", { name: /^Franchise Report/ }));
    expect(toast.info).toHaveBeenCalledWith("Franchise Report isn't in BitCRM.");
  });

  it("turns a tile on once its page is in the build — nothing else to change", () => {
    render(<ReportsPage built={Object.values(ROUTES)} />);

    for (const [name, href] of Object.entries(ROUTES)) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
    expect(screen.queryByText("Coming soon")).toBeNull();
  });

  it("without the build's list, opens every report that has a route", () => {
    render(<ReportsPage />);
    expect(screen.getByRole("link", { name: "Sales" })).toHaveAttribute("href", "/reports/sales");
    expect(screen.getAllByRole("link")).toHaveLength(Object.keys(ROUTES).length);
  });

  it("switches to Custom reports without touching the address, and shows the empty state", async () => {
    const before = window.location.href;
    render(<ReportsPage built={ON_MAIN} />);

    expect(screen.getByRole("tab", { name: "Workiz reports" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: "Custom reports" }));

    expect(screen.getByRole("tab", { name: "Custom reports" })).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel", { name: "Custom reports" });
    expect(within(panel).getByText("No custom reports found")).toBeInTheDocument();
    expect(within(panel).getByText(/Creating custom reports isn.t available/)).toBeInTheDocument();
    expect(screen.queryByRole("tabpanel", { name: "Workiz reports" })).toBeNull();
    // BitCRM can't build reports: no Create buttons anywhere.
    expect(screen.queryByRole("button", { name: /create report/i })).toBeNull();
    expect(screen.queryByText(/add custom report/i)).toBeNull();
    expect(window.location.href).toBe(before);
  });

  it("on a phone, Back lists the tabs and picking one opens it", async () => {
    render(<ReportsPage built={ON_MAIN} />);

    await userEvent.click(screen.getByRole("button", { name: /Back to the report tabs \(Workiz reports is open\)/ }));
    const list = screen.getByRole("list", { name: "Report tabs" });
    await userEvent.click(within(list).getByRole("button", { name: "Custom reports" }));

    expect(screen.queryByRole("list", { name: "Report tabs" })).toBeNull();
    expect(screen.getByRole("button", { name: /Custom reports is open/ })).toBeInTheDocument();
    expect(screen.getByText("No custom reports found")).toBeInTheDocument();
  });

  it("blocks users without the reports permission", () => {
    perms.denied = new Set(["reports.view"]);
    render(<ReportsPage built={ON_MAIN} />);

    expect(screen.getByText(/no access/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Jobs" })).not.toBeInTheDocument();
  });

  it("leaves out the reports a role may not open, as Workiz does", () => {
    perms.denied = new Set(["payments.view", "invoices.view", "financials.view", "calls.view", "commission.view", "estimates.view"]);
    render(<ReportsPage built={Object.values(ROUTES)} />);

    for (const name of ["Payments", "Estimates", "Invoices", "Aging invoices", "Tax", "Call Tracking", "Commissions (Legacy)"]) {
      expect(screen.queryByText(name)).toBeNull();
    }
    // The money-bearing reports that hide amounts themselves stay.
    for (const name of ["Jobs", "Sales", "Job Statistics", "Items and services", "Activity", "Inventory Usage"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(tileNames()).toHaveLength(WORKIZ_ORDER.length - 7);
  });
});
