"use client";

import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useJobsByStatus } from "../hooks";
import { RANGE_PRESETS, axisDayLabel, updatedAtLabel, type DashboardRange } from "../jobs-by-status";
import { DailyChart } from "./daily-chart";
import { WidgetCard } from "./widget-card";

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
  const [range, setRange] = useState<DashboardRange>(14);
  const query = useJobsByStatus(range, now);
  const days = query.data?.days ?? [];

  return (
    <WidgetCard
      className={className}
      title="Jobs By Status"
      help={HELP}
      updatedAt={query.dataUpdatedAt ? updatedAtLabel(new Date(query.dataUpdatedAt)) : undefined}
      isRefreshing={query.isFetching && !query.isLoading}
      onRefresh={() => void query.refetch()}
      toolbar={
        <div className="ml-auto">
          <Select
            value={String(range)}
            onValueChange={(v) => setRange(Number(v) as DashboardRange)}
          >
            <SelectTrigger size="sm" className="w-38" aria-label="Range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_PRESETS.map((p) => (
                <SelectItem key={p.days} value={String(p.days)}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    >
      {query.isLoading ? (
        <Skeleton className="h-52 w-full" />
      ) : query.isError ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Couldn&apos;t load the chart.
        </p>
      ) : (
        <DailyChart
          title="Jobs by status"
          days={days.map((d) => ({
            date: d.day,
            values: SERIES.map((s) => d[s.key]),
          }))}
          series={SERIES.map((s) => ({ label: s.label, className: s.className }))}
          format={(v) => v.toLocaleString("en-US")}
          labelOf={axisDayLabel}
        />
      )}
    </WidgetCard>
  );
}
