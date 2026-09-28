"use client";

import type { Action } from "@bitcrm/types";
import { usePermissions } from "@/features/auth/use-permissions";
import {
  DispatchScoreboardCard,
  JobsNowCard,
  RecentCallsCard,
  SalesCard,
  ServiceAreasCard,
  TechScoreboardCard,
  TodayCard,
  TopCallFlowsCard,
  TopJobTypesCard,
  TopSourcesCard,
} from "./dashboard-widgets";
import { JobsByStatusCard } from "./jobs-by-status-card";

/**
 * The office dashboard: a four-column grid of widgets.
 *
 * Four is the unit every widget is measured in — a pie or a stat list takes
 * one column, a chart or a board two. The grid collapses to two columns on a
 * tablet and one on a phone, and a widget's span collapses with it, so a
 * two-column chart never ends up in half a phone screen.
 *
 * The order is Workiz's, row by row:
 *   Top Sources · Sales · Top Job Types
 *   Service Areas · Top Call Flows (three wide — eight lines and their legend)
 *   Dispatch Scoreboard · Recent Calls
 *   Tech Scoreboard · Jobs · Today
 *   Jobs By Status
 */
export function DashboardPage() {
  const { can } = usePermissions();
  const sees = (action: Action<"dashboard">) => can("dashboard", action);
  // A widget the reader may not see is not rendered at all — not greyed out.
  // Its data endpoint refuses them too, so a card here would only ever show an
  // error where a card has no business being. "Sales" is nothing but money,
  // so it also needs financials.view, which its endpoint checks as well.
  const widgets = [
    sees("view_top_sources") && <TopSourcesCard key="top-sources" className="md:col-span-1" />,
    sees("view_sales") && can("financials", "view") && <SalesCard key="sales" className="md:col-span-2" />,
    sees("view_top_job_types") && <TopJobTypesCard key="top-job-types" className="md:col-span-1" />,
    sees("view_service_areas") && <ServiceAreasCard key="service-areas" className="md:col-span-1" />,
    sees("view_top_call_flows") && (
      <TopCallFlowsCard key="top-call-flows" className="md:col-span-2 xl:col-span-3" />
    ),
    sees("view_dispatch_scoreboard") && (
      <DispatchScoreboardCard key="dispatch-scoreboard" className="md:col-span-2" />
    ),
    sees("view_recent_calls") && <RecentCallsCard key="recent-calls" className="md:col-span-2" />,
    sees("view_tech_scoreboard") && <TechScoreboardCard key="tech-scoreboard" className="md:col-span-2" />,
    sees("view_jobs") && <JobsNowCard key="jobs-now" className="md:col-span-1" />,
    sees("view_today") && <TodayCard key="today" className="md:col-span-1" />,
    sees("view_jobs_by_status") && <JobsByStatusCard key="jobs-by-status" className="md:col-span-2" />,
  ].filter(Boolean);

  return (
    <div className="flex-1 p-4 md:p-6">
      {widgets.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">{widgets}</div>
      ) : (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No widgets are shared with your role yet.
        </p>
      )}
    </div>
  );
}
