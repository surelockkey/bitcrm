"use client";

import { useState } from "react";
import { useJobsByStatus } from "../hooks";
import { axisDayLabel, DEFAULT_RANGE, type DashboardRange } from "../jobs-by-status";
import { DailyChart } from "./daily-chart";
import { DashboardCard } from "./dashboard-card";

/**
 * The three states, in the order they stand in each day's group.
 *
 * Colour is the status palette rather than the categorical slots: these are
 * states, not series 1-2-3, and a state keeps its colour wherever it appears.
 * The fills are Workiz's own, stepped until adjacent bars separate — see the
 * note in `lib/theme/tokens.ts`.
 */
const SERIES = [
  { label: "Canceled", className: "bg-chart-critical", key: "canceled" },
  { label: "Open", className: "bg-chart-warning", key: "open" },
  { label: "Done", className: "bg-chart-good", key: "done" },
] as const;

const HELP =
  "Jobs counted by the day they were created and the state they are in now. " +
  "Open covers everything not yet closed, including jobs done but awaiting approval.";

/**
 * "Jobs By Status" — how the fortnight's work is landing.
 *
 * `now` is frozen for the life of the card rather than read on each render:
 * it decides the window, the window is the query key, and a clock ticking
 * inside the render would refetch the chart forever.
 */
export function JobsByStatusCard({ className }: { className?: string }) {
  const [now] = useState(() => new Date());
  const [range, setRange] = useState<DashboardRange>(DEFAULT_RANGE);
  const query = useJobsByStatus(range, now);

  return (
    <DashboardCard
      className={className}
      title="Jobs By Status"
      help={HELP}
      action="view_jobs_by_status"
      query={query}
      range={range}
      onRangeChange={setRange}
      skeletonClassName="h-52"
    >
      {(data) => (
        <DailyChart
          title="Jobs by status"
          days={data.days.map((d) => ({
            date: d.day,
            values: SERIES.map((s) => d[s.key]),
          }))}
          series={SERIES.map((s) => ({ label: s.label, className: s.className }))}
          format={(v) => v.toLocaleString("en-US")}
          labelOf={axisDayLabel}
        />
      )}
    </DashboardCard>
  );
}
