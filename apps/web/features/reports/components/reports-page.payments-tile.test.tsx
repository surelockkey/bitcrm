import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { info: vi.fn() } }));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true }),
  useDenied: () => () => false,
}));

import { ReportsPage } from "./reports-page";

describe("ReportsPage — Payments tile", () => {
  it("opens the Payments report (Workiz's /root/payments is our /payments)", () => {
    render(<ReportsPage />);
    expect(screen.getByRole("link", { name: "Payments" })).toHaveAttribute("href", "/payments");
  });
});
