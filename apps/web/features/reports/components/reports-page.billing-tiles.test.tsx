import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { info: vi.fn() } }));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true }),
  useDenied: () => () => false,
}));

import { ReportsPage } from "./reports-page";

describe("ReportsPage — billing tiles", () => {
  it("opens Aging invoices and Tax on their reports", () => {
    render(<ReportsPage />);
    expect(screen.getByRole("link", { name: "Aging invoices" })).toHaveAttribute("href", "/reports/aging-invoices");
    expect(screen.getByRole("link", { name: "Tax" })).toHaveAttribute("href", "/reports/tax");
  });
});
