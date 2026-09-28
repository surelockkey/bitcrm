"use client";

import { usePermissions } from "@/features/auth/use-permissions";
import { JobsByStatusCard } from "./jobs-by-status-card";

/**
 * The office dashboard: a four-column grid of widgets.
 *
 * Four is the unit every widget is measured in — a KPI tile takes one column,
 * a chart two, a wide table four. The grid collapses to two columns on a
 * tablet and one on a phone, and a widget's span collapses with it, so a
 * two-column chart never ends up in half a phone screen.
 */
export function DashboardPage() {
  const { can } = usePermissions();
  // A widget the reader may not see is not rendered at all — not greyed out.
  // Its data endpoint refuses them too, so a card here would only ever show an
  // error where a card has no business being.
  const widgets = [
    can("dashboard", "view_jobs_by_status") && (
      <JobsByStatusCard key="jobs-by-status" className="md:col-span-2" />
    ),
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
