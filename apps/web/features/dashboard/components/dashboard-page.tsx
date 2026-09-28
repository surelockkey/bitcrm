"use client";

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
  return (
    <div className="flex-1 p-4 md:p-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <JobsByStatusCard className="md:col-span-2" />
      </div>
    </div>
  );
}
