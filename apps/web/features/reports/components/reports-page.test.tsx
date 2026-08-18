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

const WORKIZ_REPORTS = [
  "Jobs",
  "Tips",
  "Job Statistics",
  "Leads Report",
  "Payments",
  "Expenses",
  "Estimates",
  "Invoices",
  "Aging invoices",
  "Timesheets",
  "Items and services",
  "Tax",
  "Call Tracking",
  "Inventory Usage",
  "Franchise Report",
  "Tasks",
  "Equipment",
  "Service Plans",
];

describe("ReportsPage", () => {
  beforeEach(() => {
    toast.info.mockReset();
    perms.view = true;
  });

  it("shows every Workiz report tile", () => {
    render(<ReportsPage />);

    for (const name of WORKIZ_REPORTS) {
      expect(
        screen.queryByRole("button", { name }) ?? screen.getByRole("link", { name }),
      ).toBeInTheDocument();
    }
    expect(REPORT_TILES).toHaveLength(WORKIZ_REPORTS.length);
  });

  it("the Jobs tile opens the built report; unbuilt tiles say they're coming", () => {
    render(<ReportsPage />);

    expect(screen.getByRole("link", { name: "Jobs" })).toHaveAttribute("href", "/reports/jobs");

    fireEvent.click(screen.getByRole("button", { name: "Tips" }));
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("Tips"));
  });

  it("blocks users without the reports permission", () => {
    perms.view = false;
    render(<ReportsPage />);

    expect(screen.getByText(/no access/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Jobs" })).not.toBeInTheDocument();
  });
});
