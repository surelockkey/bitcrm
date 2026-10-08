import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithClient } from "@/test/render-with-client";
import { DashboardPage } from "./dashboard-page";

const grants: Record<string, boolean> = { "dashboard.view_jobs_by_status": true };

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: (resource: string, action: string) => grants[`${resource}.${action}`] ?? false,
    me: { id: "u1" },
  }),
}));

const bundle = { isPending: false, data: { at: 1 } as unknown, isError: false, fetchStatus: "idle" };
const bundleCalls: unknown[] = [];
vi.mock("../hooks", () => ({
  useDashboardBundle: (_now: Date, extras: unknown) => {
    bundleCalls.push(extras);
    return bundle;
  },
}));

vi.mock("./dashboard-widgets", () => {
  const stub = (id: string) => {
    const Stub = ({ className, onRemove }: { className?: string; onRemove?: () => void }) => (
      <div data-testid={id} className={className}>
        <button type="button" onClick={onRemove}>
          Remove {id}
        </button>
      </div>
    );
    Stub.displayName = id;
    return Stub;
  };
  return {
    TopSourcesCard: stub("top-sources"),
    InvoicesCard: stub("invoices"),
    SalesCard: stub("sales"),
    TopJobTypesCard: stub("top-job-types"),
    EstimatesCard: stub("estimates"),
    ComingUpCard: stub("coming-up"),
    ServiceAreasCard: stub("service-areas"),
    TopCallFlowsCard: stub("top-call-flows"),
    RecentActivityCard: stub("recent-activity"),
    DispatchScoreboardCard: stub("dispatch-scoreboard"),
    RecentCallsCard: stub("recent-calls"),
    TechScoreboardCard: stub("tech-scoreboard"),
    JobsNowCard: stub("jobs-now"),
    TodayCard: stub("today"),
  };
});

vi.mock("./jobs-by-status-card", () => ({
  JobsByStatusCard: ({ className }: { className?: string }) => <div data-testid="jobs-by-status" className={className} />,
}));

afterEach(() => localStorage.clear());

/**
 * Сітка дашборда як у Workiz Home і видимість віджетів.
 *
 * Віджет, якого роль не бачить, не рендериться зовсім — не «сіріє». Його
 * ендпоінт цій ролі теж відмовляє, тож картка тут показувала б лише помилку
 * там, де картки взагалі не має бути.
 */
describe("DashboardPage", () => {
  it("lays the widgets out on Workiz's four-column grid", () => {
    const { container } = renderWithClient(<DashboardPage />);
    const grid = container.querySelector(".grid");
    expect(grid?.className).toContain("xl:grid-cols-4");
    expect(grid?.className).toContain("gap-y-[25px]");
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

  // [card, its dashboard grant, the resource grant its data needs, wide?]
  const WIDGETS: [string, string, string | null, boolean][] = [
    ["top-sources", "view_top_sources", null, false],
    ["invoices", "view_invoices", "invoices.view", false],
    ["sales", "view_sales", "financials.view", true],
    ["top-job-types", "view_top_job_types", null, false],
    ["estimates", "view_estimates", "estimates.view", false],
    ["coming-up", "view_coming_up", "deals.view", false],
    ["service-areas", "view_service_areas", null, false],
    ["top-call-flows", "view_top_call_flows", null, true],
    ["recent-activity", "view_recent_activity", "reports.view", false],
    ["dispatch-scoreboard", "view_dispatch_scoreboard", null, true],
    ["recent-calls", "view_recent_calls", null, true],
    ["tech-scoreboard", "view_tech_scoreboard", null, true],
    ["jobs-now", "view_jobs", null, false],
    ["today", "view_today", null, false],
  ];
  const grantAll = (on: boolean) => {
    for (const [, action, needs] of WIDGETS) {
      grants[`dashboard.${action}`] = on;
      if (needs) grants[needs] = on;
    }
  };

  it.each(WIDGETS)("%s shows with dashboard.%s (and %s)", (id, action, needs, wide) => {
    grants[`dashboard.${action}`] = true;
    if (needs) grants[needs] = true;
    renderWithClient(<DashboardPage />);
    const card = screen.getByTestId(id);
    if (wide) expect(card.className).toContain("md:col-span-2");
    else expect(card.className).not.toContain("col-span-2");
    grants[`dashboard.${action}`] = false;
    if (needs) grants[needs] = false;
  });

  it.each(WIDGETS.filter((w) => w[2]))("%s stays out without the data's own grant (%s)", (id, action) => {
    grants[`dashboard.${action}`] = true;
    renderWithClient(<DashboardPage />);
    expect(screen.queryByTestId(id)).toBeNull();
    grants[`dashboard.${action}`] = false;
  });

  it.each(WIDGETS)("%s stays out without dashboard.%s", (id, _action, needs) => {
    if (needs) grants[needs] = true;
    renderWithClient(<DashboardPage />);
    expect(screen.queryByTestId(id)).toBeNull();
    if (needs) grants[needs] = false;
  });

  it("lays them out in Workiz's order", () => {
    grantAll(true);
    const { container } = renderWithClient(<DashboardPage />);
    const order = [...container.querySelectorAll("[data-testid]")].map((n) => n.getAttribute("data-testid"));
    expect(order).toEqual([
      "top-sources",
      "jobs-by-status",
      "invoices",
      "sales",
      "top-job-types",
      "estimates",
      "coming-up",
      "service-areas",
      "top-call-flows",
      "recent-activity",
      "dispatch-scoreboard",
      "recent-calls",
      "tech-scoreboard",
      "jobs-now",
      "today",
    ]);
    grantAll(false);
  });

  it("asks the bundle only for the extra widgets on show", () => {
    grants["dashboard.view_invoices"] = true;
    grants["invoices.view"] = true;
    bundleCalls.length = 0;
    renderWithClient(<DashboardPage />);
    expect(bundleCalls.at(-1)).toEqual({
      invoices: true,
      estimates: false,
      comingUp: false,
      recentActivity: false,
      collected: false,
    });
    grants["dashboard.view_invoices"] = false;
    grants["invoices.view"] = false;
  });

  // Workiz: «Remove» у меню віджета і панель «Dashboard widgets» за шестернею.
  it("takes a widget off on Remove, and remembers it for this person", async () => {
    const user = userEvent.setup();
    grants["dashboard.view_top_sources"] = true;
    const { unmount } = renderWithClient(<DashboardPage />);
    await user.click(screen.getByRole("button", { name: "Remove top-sources" }));
    expect(screen.queryByTestId("top-sources")).toBeNull();
    unmount();

    renderWithClient(<DashboardPage />);
    expect(screen.queryByTestId("top-sources")).toBeNull();
    expect(screen.getByTestId("jobs-by-status")).toBeInTheDocument();
    grants["dashboard.view_top_sources"] = false;
  });

  it("brings a widget back from the Dashboard widgets panel", async () => {
    const user = userEvent.setup();
    grants["dashboard.view_top_sources"] = true;
    localStorage.setItem("bitcrm:dashboard:hidden:u1", JSON.stringify(["top-sources"]));
    renderWithClient(<DashboardPage />);
    expect(screen.queryByTestId("top-sources")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Dashboard widgets" }));
    const box = screen.getByRole("checkbox", { name: "Top Sources" });
    expect(box).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Jobs By Status" })).toBeChecked();
    await user.click(box);
    expect(screen.getByTestId("top-sources")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("bitcrm:dashboard:hidden:u1")!)).toEqual([]);
    grants["dashboard.view_top_sources"] = false;
  });

  // Поки пакет у дорозі — один скелет замість карток; потім усі картки разом.
  it("draws no card while the opening bundle is on its way, then every card at once", () => {
    grants["dashboard.view_top_sources"] = true;
    Object.assign(bundle, { isPending: true, data: undefined, fetchStatus: "fetching" });
    const { unmount } = renderWithClient(<DashboardPage />);
    expect(screen.getByRole("status", { name: "Loading the dashboard" })).toBeInTheDocument();
    expect(screen.queryByTestId("top-sources")).toBeNull();
    expect(screen.queryByTestId("jobs-by-status")).toBeNull();
    unmount();

    Object.assign(bundle, { isPending: false, data: { at: 1 }, fetchStatus: "idle" });
    renderWithClient(<DashboardPage />);
    expect(screen.queryByRole("status", { name: "Loading the dashboard" })).toBeNull();
    expect(screen.getByTestId("top-sources")).toBeInTheDocument();
    expect(screen.getByTestId("jobs-by-status")).toBeInTheDocument();
    grants["dashboard.view_top_sources"] = false;
  });

  it("lets the cards go when the bundle fails — they fetch on their own", () => {
    Object.assign(bundle, { isPending: false, data: undefined, isError: true, fetchStatus: "idle" });
    renderWithClient(<DashboardPage />);
    expect(screen.getByTestId("jobs-by-status")).toBeInTheDocument();
    Object.assign(bundle, { data: { at: 1 }, isError: false });
  });
});
