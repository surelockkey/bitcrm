import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithClient } from "@/test/render-with-client";
import { useDashboardReady } from "../bundle-context";
import { DashboardPage } from "./dashboard-page";

const grants: Record<string, boolean> = { "dashboard.view_jobs_by_status": true };

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: (resource: string, action: string) => grants[`${resource}.${action}`] ?? false,
  }),
}));

const bundle = { isPending: false };
vi.mock("../hooks", () => ({ useDashboardBundle: () => bundle }));

vi.mock("./dashboard-widgets", () => {
  const stub = (id: string) => {
    const Stub = ({ className }: { className?: string }) => (
      <div data-testid={id} className={className} data-ready={String(useDashboardReady())} />
    );
    Stub.displayName = id;
    return Stub;
  };
  return {
    SalesCard: stub("sales"),
    TopSourcesCard: stub("top-sources"),
    TopJobTypesCard: stub("top-job-types"),
    ServiceAreasCard: stub("service-areas"),
    TopCallFlowsCard: stub("top-call-flows"),
    DispatchScoreboardCard: stub("dispatch-scoreboard"),
    TechScoreboardCard: stub("tech-scoreboard"),
    RecentCallsCard: stub("recent-calls"),
    JobsNowCard: stub("jobs-now"),
    TodayCard: stub("today"),
  };
});

vi.mock("./jobs-by-status-card", () => ({
  JobsByStatusCard: ({ className }: { className?: string }) => (
    <div data-testid="jobs-by-status" className={className} data-ready={String(useDashboardReady())} />
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

  const WIDGETS: [string, string, string][] = [
    ["top-sources", "view_top_sources", "md:col-span-1"],
    ["sales", "view_sales", "md:col-span-2"],
    ["top-job-types", "view_top_job_types", "md:col-span-1"],
    ["service-areas", "view_service_areas", "md:col-span-1"],
    ["top-call-flows", "view_top_call_flows", "xl:col-span-3"],
    ["dispatch-scoreboard", "view_dispatch_scoreboard", "md:col-span-2"],
    ["recent-calls", "view_recent_calls", "md:col-span-2"],
    ["tech-scoreboard", "view_tech_scoreboard", "md:col-span-2"],
    ["jobs-now", "view_jobs", "md:col-span-1"],
    ["today", "view_today", "md:col-span-1"],
  ];

  it.each(WIDGETS)("%s shows with dashboard.%s, spanning %s", (id, action, span) => {
    grants[`dashboard.${action}`] = true;
    grants["financials.view"] = true;
    renderWithClient(<DashboardPage />);
    expect(screen.getByTestId(id).className).toContain(span);
    grants[`dashboard.${action}`] = false;
    grants["financials.view"] = false;
  });

  it.each(WIDGETS)("%s stays out without dashboard.%s", (id) => {
    grants["financials.view"] = true;
    renderWithClient(<DashboardPage />);
    expect(screen.queryByTestId(id)).toBeNull();
    grants["financials.view"] = false;
  });

  // «Sales» — самі гроші: без financials.view сервер відмовить, тож картки нема.
  it("Sales also needs financials.view", () => {
    grants["dashboard.view_sales"] = true;
    renderWithClient(<DashboardPage />);
    expect(screen.queryByTestId("sales")).toBeNull();
    grants["dashboard.view_sales"] = false;
  });

  it("lays them out in Workiz's order", () => {
    for (const [, action] of WIDGETS) grants[`dashboard.${action}`] = true;
    grants["financials.view"] = true;
    const { container } = renderWithClient(<DashboardPage />);
    const order = [...container.querySelectorAll("[data-testid]")].map((n) => n.getAttribute("data-testid"));
    expect(order).toEqual([
      "top-sources",
      "sales",
      "top-job-types",
      "service-areas",
      "top-call-flows",
      "dispatch-scoreboard",
      "recent-calls",
      "tech-scoreboard",
      "jobs-now",
      "today",
      "jobs-by-status",
    ]);
    for (const [, action] of WIDGETS) grants[`dashboard.${action}`] = false;
    grants["financials.view"] = false;
  });

  // Картки чекають на пакет і заповнюються разом, а не по одній.
  it("holds every card while the opening bundle is on its way, then lets them all go", () => {
    grants["dashboard.view_top_sources"] = true;
    bundle.isPending = true;
    const { unmount } = renderWithClient(<DashboardPage />);
    expect(screen.getByTestId("top-sources").dataset.ready).toBe("false");
    expect(screen.getByTestId("jobs-by-status").dataset.ready).toBe("false");
    unmount();

    bundle.isPending = false;
    renderWithClient(<DashboardPage />);
    expect(screen.getByTestId("top-sources").dataset.ready).toBe("true");
    grants["dashboard.view_top_sources"] = false;
  });
});
