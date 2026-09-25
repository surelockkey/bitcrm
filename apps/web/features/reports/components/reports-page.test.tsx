import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { toast, perms } = vi.hoisted(() => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
  perms: { view: true },
}));

vi.mock("sonner", () => ({ toast }));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => perms.view }),
}));

import { ReportsPage, REPORT_TILES } from "./reports-page";

/** The Workiz reports this business keeps, in Workiz's on-screen order. */
const WORKIZ_REPORTS = [
  "Jobs",
  "Job Statistics",
  "Payments",
  "Activity",
  "Estimates",
  "Invoices",
  "Aging invoices",
  "Items and services",
  "Website requests",
  "Tax",
  "Call Tracking",
  "Inventory Usage",
  "Franchise Report",
  "Commissions (Legacy)",
];

/** Workiz reports this business does not use — no tile for them. */
const DROPPED = ["Performance Pay", "Sales", "Tips", "Leads Report", "Expenses", "Timesheets", "Tasks", "Equipment", "Service Plans"];

describe("ReportsPage", () => {
  beforeEach(() => {
    toast.info.mockReset();
    perms.view = true;
  });

  it("shows the kept Workiz reports, in order, and none of the dropped ones", () => {
    render(<ReportsPage />);

    for (const name of WORKIZ_REPORTS) {
      expect(
        screen.queryByRole("button", { name }) ?? screen.getByRole("link", { name }),
      ).toBeInTheDocument();
    }
    expect(REPORT_TILES.map((t) => t.name)).toEqual(WORKIZ_REPORTS);
    for (const name of DROPPED) expect(screen.queryByText(name)).toBeNull();
  });

  it("opens Estimates and Invoices on their own pages, as Workiz does", () => {
    render(<ReportsPage />);
    expect(screen.getByRole("link", { name: "Estimates" })).toHaveAttribute("href", "/estimates");
    expect(screen.getByRole("link", { name: "Invoices" })).toHaveAttribute("href", "/invoices");
  });

  it("the Jobs tile opens the built report; unbuilt tiles say they're coming", () => {
    render(<ReportsPage />);

    expect(screen.getByRole("link", { name: "Jobs" })).toHaveAttribute("href", "/reports/jobs");
    expect(screen.getByRole("link", { name: "Job Statistics" })).toHaveAttribute("href", "/reports/job-statistics");

    fireEvent.click(screen.getByRole("button", { name: "Franchise Report" }));
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("Franchise Report"));
  });

  it("blocks users without the reports permission", () => {
    perms.view = false;
    render(<ReportsPage />);

    expect(screen.getByText(/no access/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Jobs" })).not.toBeInTheDocument();
  });
});
