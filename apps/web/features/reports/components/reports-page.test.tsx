import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const { perms } = vi.hoisted(() => ({ perms: { denied: new Set<string>() } }));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: (r: string, a = "view") => !perms.denied.has(`${r}.${a}`), isLoading: false }),
  // This suite asserts refusals, so it mirrors `can` rather than declaring
  // nobody is ever refused.
  useDenied: () => (r: string, a = "view") => perms.denied.has(`${r}.${a}`),
}));

import { ReportsPage } from "./reports-page";

/**
 * The Reports hub as Workiz draws it (`/root/_reports?view=workiz-reports`,
 * rep_hub_wz_01_default): the "Reports" heading, the tab row, and a card per
 * report — only the reports BitCRM has, in Workiz's order.
 */

/** Every report page BitCRM has today. */
const BUILT = [
  "/reports/jobs", "/reports/job-statistics", "/reports/payments", "/reports/activity",
  "/estimates", "/invoices", "/reports/aging-invoices", "/reports/items",
  "/reports/tax", "/reports/call-tracking", "/reports/commission",
];

const SHOWN = [
  "Jobs", "Job Statistics", "Payments", "Activity",
  "Estimates", "Invoices", "Aging invoices",
  "Items and services", "Tax", "Call Tracking", "Commissions (Legacy)",
];

const DROPPED = [
  "Performance Pay", "Sales", "Tips", "Leads Report", "Expenses",
  "Timesheets", "Tasks", "Equipment", "Service Plans",
];

const hub = () => screen.getByRole("list", { name: "Reports" });
const cardNames = () => within(hub()).getAllByRole("link").map((a) => a.textContent);

describe("ReportsPage", () => {
  beforeEach(() => {
    perms.denied = new Set();
  });

  it("shows a card for each report BitCRM has, in Workiz's order", () => {
    render(<ReportsPage built={BUILT} />);
    expect(cardNames()).toEqual(SHOWN);
  });

  it("has no card for a dropped report or for one without a page — no dead tiles", () => {
    render(<ReportsPage built={BUILT} />);
    for (const name of [...DROPPED, "Website requests", "Inventory Usage", "Franchise Report"]) {
      expect(screen.queryByText(name)).toBeNull();
    }
    expect(within(hub()).queryAllByRole("button")).toEqual([]);
    expect(screen.queryByText(/coming soon|not in bitcrm/i)).toBeNull();
  });

  it("opens each report on its page; Estimates and Invoices on their lists, as Workiz's tiles do", () => {
    render(<ReportsPage built={BUILT} />);
    const href = (name: string) => within(hub()).getByRole("link", { name }).getAttribute("href");
    expect(href("Jobs")).toBe("/reports/jobs");
    expect(href("Job Statistics")).toBe("/reports/job-statistics");
    expect(href("Payments")).toBe("/reports/payments");
    expect(href("Activity")).toBe("/reports/activity");
    expect(href("Estimates")).toBe("/estimates");
    expect(href("Invoices")).toBe("/invoices");
    expect(href("Aging invoices")).toBe("/reports/aging-invoices");
    expect(href("Items and services")).toBe("/reports/items");
    expect(href("Tax")).toBe("/reports/tax");
    expect(href("Call Tracking")).toBe("/reports/call-tracking");
    expect(href("Commissions (Legacy)")).toBe("/reports/commission");
  });

  it("is laid out like Workiz's hub: the heading, then the reports tab, then the cards", () => {
    render(<ReportsPage built={BUILT} />);
    const heading = screen.getByRole("heading", { level: 1, name: "Reports" });
    expect(heading.className).toContain("text-[25px]");

    // Workiz's "Workiz reports" tab, ours by name; there are no custom reports
    // in BitCRM, so no "Custom reports" tab and no "Create report" buttons.
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["BitCRM reports"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText(/custom reports/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /create report/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /back/i })).toBeNull();

    // The cards hang under the tab, in its panel.
    expect(screen.getByRole("tabpanel", { name: "BitCRM reports" })).toContainElement(hub());
  });

  it("prints only the report's name on its card, as Workiz does — no line under it", () => {
    render(<ReportsPage built={BUILT} />);
    const jobs = within(hub()).getByRole("link", { name: "Jobs" });
    expect(jobs).toHaveTextContent(/^Jobs$/);
    expect(jobs).not.toHaveAttribute("aria-describedby");
  });

  it("without the build's list, opens every report that has a route", () => {
    render(<ReportsPage />);
    expect(within(hub()).getByRole("link", { name: "Activity" })).toHaveAttribute("href", "/reports/activity");
    expect(cardNames()).toHaveLength(12);
  });

  it("blocks users without the reports permission", () => {
    perms.denied = new Set(["reports.view"]);
    render(<ReportsPage built={BUILT} />);

    expect(screen.getByText(/no access/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Jobs" })).not.toBeInTheDocument();
  });

  it("leaves out the reports a role may not open, as Workiz does", () => {
    perms.denied = new Set(["payments.view", "invoices.view", "financials.view", "calls.view", "commission.view", "estimates.view"]);
    render(<ReportsPage built={BUILT} />);

    for (const name of ["Payments", "Estimates", "Invoices", "Aging invoices", "Tax", "Call Tracking", "Commissions (Legacy)"]) {
      expect(screen.queryByText(name)).toBeNull();
    }
    // The money-bearing reports that hide amounts themselves stay.
    expect(cardNames()).toEqual(["Jobs", "Job Statistics", "Activity", "Items and services"]);
  });
});
