import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { info: vi.fn() } }));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true }),
  useDenied: () => () => false,
}));

import { ReportsPage } from "./reports-page";

describe("ReportsPage — Activity and Call Tracking", () => {
  it("opens both built reports from their tiles", () => {
    render(<ReportsPage />);
    expect(screen.getByRole("link", { name: "Activity" })).toHaveAttribute("href", "/reports/activity");
    expect(screen.getByRole("link", { name: "Call Tracking" })).toHaveAttribute("href", "/reports/call-tracking");
  });
});
