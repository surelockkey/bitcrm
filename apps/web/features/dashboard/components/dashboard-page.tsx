"use client";

import { useState, type ComponentType } from "react";
import type { Action } from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { useDashboardBundle } from "../hooks";
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

interface Widget {
  key: string;
  /** Its span of the four columns. */
  className: string;
  Card: ComponentType<{ className?: string }>;
}

/** Every widget's span, in Workiz's order — what the skeleton is drawn from. */
const SPANS = [
  "md:col-span-1", // Top Sources
  "md:col-span-2", // Sales
  "md:col-span-1", // Top Job Types
  "md:col-span-1", // Service Areas
  "md:col-span-2 xl:col-span-3", // Top Call Flows
  "md:col-span-2", // Dispatch Scoreboard
  "md:col-span-2", // Recent Calls
  "md:col-span-2", // Tech Scoreboard
  "md:col-span-1", // Jobs
  "md:col-span-1", // Today
  "md:col-span-2", // Jobs By Status
];

const GRID = "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4";

/**
 * The dashboard while it loads: one grey card for each of Workiz's widgets.
 * The same one stands while the role is read (`/`) and while the opening
 * bundle is on its way, so the page goes from it to the filled cards once.
 */
export function DashboardSkeleton() {
  return (
    <div className="flex-1 p-4 md:p-6" role="status" aria-label="Loading the dashboard">
      <div className={GRID}>
        {SPANS.map((span, i) => (
          <Skeleton key={i} className={cn("h-80 rounded-xl", span)} />
        ))}
      </div>
    </div>
  );
}

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
  // One read per service for everything the page opens with, laid into each
  // card's own cache entry. The cards are not drawn until it has settled:
  // drawn earlier, each stood around a grey bar of a guessed height and every
  // row moved the rows under it as the bodies filled. Now they come in one
  // frame, filled. If a service fails, its cards fetch on their own — slower,
  // never stuck.
  const [now] = useState(() => new Date());
  const bundle = useDashboardBundle(now);
  const ready = usePageReady(settled(bundle));
  const sees = (action: Action<"dashboard">) => can("dashboard", action);
  // A widget the reader may not see is not rendered at all — not greyed out.
  // Its data endpoint refuses them too, so a card here would only ever show an
  // error where a card has no business being. "Sales" is nothing but money,
  // so it also needs financials.view, which its endpoint checks as well.
  const offered: (Widget | false)[] = [
    sees("view_top_sources") && { key: "top-sources", className: SPANS[0], Card: TopSourcesCard },
    sees("view_sales") && can("financials", "view") && { key: "sales", className: SPANS[1], Card: SalesCard },
    sees("view_top_job_types") && { key: "top-job-types", className: SPANS[2], Card: TopJobTypesCard },
    sees("view_service_areas") && { key: "service-areas", className: SPANS[3], Card: ServiceAreasCard },
    sees("view_top_call_flows") && { key: "top-call-flows", className: SPANS[4], Card: TopCallFlowsCard },
    sees("view_dispatch_scoreboard") && { key: "dispatch-scoreboard", className: SPANS[5], Card: DispatchScoreboardCard },
    sees("view_recent_calls") && { key: "recent-calls", className: SPANS[6], Card: RecentCallsCard },
    sees("view_tech_scoreboard") && { key: "tech-scoreboard", className: SPANS[7], Card: TechScoreboardCard },
    sees("view_jobs") && { key: "jobs-now", className: SPANS[8], Card: JobsNowCard },
    sees("view_today") && { key: "today", className: SPANS[9], Card: TodayCard },
    sees("view_jobs_by_status") && { key: "jobs-by-status", className: SPANS[10], Card: JobsByStatusCard },
  ];
  const widgets = offered.filter((w): w is Widget => Boolean(w));

  if (widgets.length && !ready) return <DashboardSkeleton />;

  return (
    <div className="flex-1 p-4 md:p-6">
      {widgets.length ? (
        <div className={GRID}>
          {widgets.map(({ key, className, Card }) => (
            <Card key={key} className={className} />
          ))}
        </div>
      ) : (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No widgets are shared with your role yet.
        </p>
      )}
    </div>
  );
}
