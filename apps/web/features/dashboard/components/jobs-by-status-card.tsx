"use client";

import { useState } from "react";
import type { DashboardPreset } from "@bitcrm/types";
import { WzBarChart } from "@/components/workiz/charts";
import { WzChartLegend, WzRangeSelect } from "@/components/workiz/widget";
import { useJobsByStatus } from "../hooks";
import { DEFAULT_PRESET, WIDGET_RANGES, rangeWindowOf } from "../ranges";
import { DashboardCard } from "./dashboard-card";

/** The three states in the order they stand in each day's group, in Workiz's fills. */
const SERIES = [
  { label: "Canceled", color: "var(--wz-chart-canceled)", key: "canceled" },
  { label: "Open", color: "var(--wz-chart-open)", key: "open" },
  { label: "Done", color: "var(--wz-chart-done)", key: "done" },
] as const;

/**
 * "Jobs By Status" — how the period's work is landing: jobs counted by the
 * day they were created and the state they are in now.
 *
 * `now` is frozen for the life of the card rather than read on each render:
 * it decides the window, the window is the query key, and a clock ticking
 * inside the render would refetch the chart forever.
 */
export function JobsByStatusCard({ className, onRemove }: { className?: string; onRemove?: () => void }) {
  const [now] = useState(() => new Date());
  const [range, setRange] = useState<DashboardPreset>(DEFAULT_PRESET);
  const query = useJobsByStatus(rangeWindowOf(range, now)!);

  return (
    <DashboardCard
      className={className}
      onRemove={onRemove}
      title="Jobs By Status"
      help="Jobs by status according to the day the job was created."
      action="view_jobs_by_status"
      query={query}
      stamped
    >
      {(data) => (
        <>
          <div className="flex items-start justify-between gap-3">
            <WzChartLegend items={SERIES.map((s) => ({ label: s.label, color: s.color }))} />
            <WzRangeSelect label="Range" value={range} options={WIDGET_RANGES} onChange={setRange} />
          </div>
          <WzBarChart
            className="mt-[33px]"
            title="Jobs by status"
            days={data.days.map((d) => d.day)}
            series={SERIES.map((s) => ({ label: s.label, color: s.color, values: data.days.map((d) => d[s.key]) }))}
            format={(v) => v.toLocaleString("en-US")}
          />
        </>
      )}
    </DashboardCard>
  );
}
