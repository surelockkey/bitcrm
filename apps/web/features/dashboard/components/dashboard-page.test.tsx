import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithClient } from "@/test/render-with-client";
import { DashboardPage } from "./dashboard-page";

const grants: Record<string, boolean> = { "dashboard.view_jobs_by_status": true };

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({
    can: (resource: string, action: string) => grants[`${resource}.${action}`] ?? false,
  }),
}));

vi.mock("./jobs-by-status-card", () => ({
  JobsByStatusCard: ({ className }: { className?: string }) => (
    <div data-testid="jobs-by-status" className={className} />
  ),
}));

/**
 * Сітка дашборда і видимість віджетів.
 *
 * Віджет, якого роль не бачить, не рендериться зовсім — не «сіріє». Його
 * ендпоінт цій ролі теж відмовляє, тож картка тут показувала б лише помилку
 * там, де картки взагалі не має бути.
 */
describe("DashboardPage", () => {
  it("lays the widgets out in a four-column grid", () => {
    const { container } = renderWithClient(<DashboardPage />);
    const grid = container.querySelector(".grid");
    expect(grid?.className).toContain("xl:grid-cols-4");
  });

  it("gives the chart two of the four columns", () => {
    renderWithClient(<DashboardPage />);
    expect(screen.getByTestId("jobs-by-status").className).toContain("md:col-span-2");
  });

  it("leaves out a widget the role may not see", () => {
    grants["dashboard.view_jobs_by_status"] = false;
    renderWithClient(<DashboardPage />);
    expect(screen.queryByTestId("jobs-by-status")).toBeNull();
    expect(screen.getByText("No widgets are shared with your role yet.")).toBeInTheDocument();
    grants["dashboard.view_jobs_by_status"] = true;
  });
});
