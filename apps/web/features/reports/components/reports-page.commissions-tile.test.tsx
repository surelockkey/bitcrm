import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { info: vi.fn() } }));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true }),
  useDenied: () => () => false,
}));

import { ReportsPage } from "./reports-page";

describe("ReportsPage — Commissions (Legacy) tile", () => {
  it("opens the commissions report (Workiz's Finance Reporting)", () => {
    render(<ReportsPage />);
    expect(screen.getByRole("link", { name: "Commissions (Legacy)" })).toHaveAttribute("href", "/reports/commission");
  });
});
