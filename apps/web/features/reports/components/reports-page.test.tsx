import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

/**
 * The 14 reports the business kept (2026-09-25, confirmed on 2026-10-01), in
 * Workiz's order. Performance Pay, Sales, Tips, Leads, Expenses, Timesheets,
 * Tasks, Equipment and Service Plans are gone for good.
 */
const KEPT = [
  "Jobs", "Job Statistics", "Payments", "Activity",
  "Estimates", "Invoices", "Aging invoices",
  "Items and services", "Website requests",
  "Tax", "Call Tracking", "Inventory Usage",
  "Franchise Report", "Commissions (Legacy)",
];

const DROPPED = [
  "Performance Pay", "Sales", "Tips", "Leads Report", "Expenses",
  "Timesheets", "Tasks", "Equipment", "Service Plans",
];

/** Where each report lives in BitCRM — on main or in its open PR. */
const ROUTES: Record<string, string> = {
  Jobs: "/reports/jobs",
  "Job Statistics": "/reports/job-statistics",
  Payments: "/payments",
  Activity: "/reports/activity",
  Estimates: "/estimates",
  Invoices: "/invoices",
  "Aging invoices": "/reports/aging-invoices",
  "Items and services": "/reports/items",
  Tax: "/reports/tax",
  "Call Tracking": "/reports/call-tracking",
  "Inventory Usage": "/reports/inventory-usage",
  "Commissions (Legacy)": "/reports/commission",
};

/** Kept on the hub, but nobody is building a page for them yet. */
const NOT_IN_BITCRM = ["Website requests", "Franchise Report"];

/** The report pages on main today. */
const ON_MAIN = ["/reports/jobs", "/reports/job-statistics", "/payments", "/estimates", "/invoices"];

const hub = () => screen.getByRole("list", { name: "Reports" });
/** The tiles' names in page order — links and "not yet" buttons alike. */
const tileNames = () =>
  [...hub().querySelectorAll("a, button")].map((el) => el.querySelector("[data-slot=report-name]")?.textContent ?? "");

describe("ReportsPage", () => {
  beforeEach(() => {
    toast.info.mockReset();
    perms.denied = new Set();
  });

  it("shows the 14 kept reports, in Workiz's order, and none of the dropped ones", () => {
    render(<ReportsPage built={ON_MAIN} />);

    expect(REPORT_TILES.map((t) => t.name)).toEqual(KEPT);
    expect(tileNames()).toEqual(KEPT);
    for (const name of DROPPED) expect(screen.queryByText(name)).toBeNull();
  });

  it("is laid out like the rest of BitCRM: one list under the page title, no Workiz tabs or font", () => {
    render(<ReportsPage built={ON_MAIN} />);

    expect(screen.getByRole("heading", { level: 1, name: "Reports" })).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByText(/custom reports/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /back/i })).toBeNull();
    // Every tile says what the report is for, as the Settings list does.
    for (const tile of REPORT_TILES) expect(tile.description).toMatch(/\S/);
    expect(screen.getByText(REPORT_TILES[0].description)).toBeInTheDocument();
  });

  it("points every report at its BitCRM page, the open PRs' pages included", () => {
    expect(Object.fromEntries(REPORT_TILES.filter((t) => t.href).map((t) => [t.name, t.href]))).toEqual(ROUTES);
    expect(REPORT_TILES.filter((t) => !t.href).map((t) => t.name)).toEqual(NOT_IN_BITCRM);
  });

  it("opens only the reports that are built; a report still in a PR says it's coming", async () => {
    render(<ReportsPage built={ON_MAIN} />);

    expect(screen.getByRole("link", { name: /^Jobs/ })).toHaveAttribute("href", "/reports/jobs");
    expect(screen.getByRole("link", { name: /^Job Statistics/ })).toHaveAttribute("href", "/reports/job-statistics");
    // Workiz opens these on the pages of the same name.
    expect(screen.getByRole("link", { name: /^Estimates/ })).toHaveAttribute("href", "/estimates");
    expect(screen.getByRole("link", { name: /^Invoices/ })).toHaveAttribute("href", "/invoices");
    expect(screen.getByRole("link", { name: /^Payments/ })).toHaveAttribute("href", "/payments");

    const activity = screen.getByRole("button", { name: /^Activity/ });
    expect(activity).toHaveAttribute("aria-disabled", "true");
    expect(activity).toHaveTextContent("Coming soon");
    expect(screen.queryByRole("link", { name: /^Activity/ })).toBeNull();
    await userEvent.click(activity);
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("Activity"));
  });

  it("greys out the reports BitCRM doesn't have, and says so", async () => {
    render(<ReportsPage built={ON_MAIN} />);

    for (const name of NOT_IN_BITCRM) {
      const tile = screen.getByRole("button", { name: new RegExp(`^${name}`) });
      expect(tile).toHaveAttribute("aria-disabled", "true");
      expect(tile).toHaveTextContent("Not in BitCRM");
    }
    await userEvent.click(screen.getByRole("button", { name: /^Franchise Report/ }));
    expect(toast.info).toHaveBeenCalledWith("Franchise Report isn't in BitCRM.");
  });

  it("turns a tile on once its page is in the build — nothing else to change", () => {
    render(<ReportsPage built={Object.values(ROUTES)} />);

    for (const [name, href] of Object.entries(ROUTES)) {
      expect(screen.getByRole("link", { name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}`) })).toHaveAttribute("href", href);
    }
    expect(screen.queryByText("Coming soon")).toBeNull();
  });

  it("without the build's list, opens every report that has a route", () => {
    render(<ReportsPage />);
    expect(screen.getByRole("link", { name: /^Activity/ })).toHaveAttribute("href", "/reports/activity");
    expect(screen.getAllByRole("link")).toHaveLength(Object.keys(ROUTES).length);
  });

  it("blocks users without the reports permission", () => {
    perms.denied = new Set(["reports.view"]);
    render(<ReportsPage built={ON_MAIN} />);

    expect(screen.getByText(/no access/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Jobs/ })).not.toBeInTheDocument();
  });

  it("leaves out the reports a role may not open, as Workiz does", () => {
    perms.denied = new Set(["payments.view", "invoices.view", "financials.view", "calls.view", "commission.view", "estimates.view"]);
    render(<ReportsPage built={Object.values(ROUTES)} />);

    for (const name of ["Payments", "Estimates", "Invoices", "Aging invoices", "Tax", "Call Tracking", "Commissions (Legacy)"]) {
      expect(screen.queryByText(name)).toBeNull();
    }
    // The money-bearing reports that hide amounts themselves stay.
    for (const name of ["Jobs", "Job Statistics", "Items and services", "Activity", "Inventory Usage"]) {
      expect(screen.getByRole("link", { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
    expect(tileNames()).toHaveLength(KEPT.length - 7);
  });
});
