"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CallTrackingGroupBy, CallTrackingReport } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { LineChart } from "@/features/dashboard/components/line-chart";
import { useJobSources } from "@/features/job-sources/hooks";
import { paginate } from "../lib";
import {
  CALL_TRACKING_PRESETS,
  REPORT_PRESET_LABEL,
  reportPresetRange,
  type ReportPreset,
} from "../report-dates";
import { useCallTracking } from "../call-tracking/hooks";
import {
  bucketLabel,
  CALL_TRACKING_PAGE_SIZE,
  callTrackingColumns,
  cardDuration,
  pct,
  rowDuration,
  sortTrackingRows,
  usd,
  type CallTrackingColumn,
  type CallTrackingParams,
} from "../call-tracking/lib";

type GraphBy = CallTrackingParams["graphBy"];
const GRAPH_STEPS: GraphBy[] = ["hour", "day", "week", "month"];

/**
 * Workiz Reports → Call Tracking: inbound calls by call flow or by tracked
 * number — seven cards, the calls-per-flow graph (hour of day / day / week /
 * month), and the table Workiz pages and sorts in the browser, twenty rows a
 * page. Opens on This month by call flow, as Workiz does. Revenue only with
 * `financials.view` (the server leaves it out otherwise); the whole report
 * needs `calls.view` too — Workiz's "Call Reports" restriction.
 */
export function CallTrackingPage({ today }: { today: string }) {
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const money = can("financials");
  const blocked = denied("reports", "view") || denied("calls", "view");

  const [groupBy, setGroupBy] = useState<CallTrackingGroupBy>("flows");
  const [graphBy, setGraphBy] = useState<GraphBy>("hour");
  const [preset, setPreset] = useState<ReportPreset>("this_month");
  const [custom, setCustom] = useState({ from: `${today.slice(0, 7)}-01`, to: today });
  const range = reportPresetRange(preset, today) ?? custom;
  const customValid = preset !== "custom" || (!!custom.from && !!custom.to && custom.from <= custom.to);

  const report = useCallTracking({ from: range.from, to: range.to, groupBy, graphBy }, !blocked && customValid);
  const sources = useJobSources();
  const sourceNames = useMemo(
    () => new Map((sources.data ?? []).map((s) => [s.id, s.name])),
    [sources.data],
  );
  // The report was drawn the moment it came: the ad groups' names (a catalog
  // sometimes seconds slow) filled the Ad group column in later, and with the
  // role still being read the Revenue card and column came a beat after. The
  // report comes with its names and its money.
  const ready = usePageReady(!permsLoading && [report, sources].every(settled));

  if (blocked) return <NoAccess entity="reports" />;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Call Tracking</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Group by"
            className="h-9 rounded-md border bg-transparent px-2 text-sm"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as CallTrackingGroupBy)}
          >
            <option value="flows">By Call Flow</option>
            <option value="numbers">By Phone Number</option>
          </select>
          <select
            aria-label="Date preset"
            className="h-9 rounded-md border bg-transparent px-2 text-sm"
            value={preset}
            onChange={(e) => setPreset(e.target.value as ReportPreset)}
          >
            {CALL_TRACKING_PRESETS.map((p) => (
              <option key={p} value={p}>
                {REPORT_PRESET_LABEL[p]}
              </option>
            ))}
          </select>
          {preset === "custom" ? (
            <>
              <input
                type="date"
                aria-label="From"
                className="h-9 rounded-md border bg-transparent px-2 text-sm"
                value={custom.from}
                max={today}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
              />
              <input
                type="date"
                aria-label="To"
                className="h-9 rounded-md border bg-transparent px-2 text-sm"
                value={custom.to}
                max={today}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
              />
            </>
          ) : (
            <span className="text-sm text-muted-foreground tabular-nums">
              {range.from} – {range.to}
            </span>
          )}
        </div>
      </div>

      {!customValid ? (
        <p role="alert" className="p-6 text-sm text-destructive">
          Pick a start day on or before the end day.
        </p>
      ) : report.error ? (
        <p role="alert" className="p-6 text-sm text-destructive">
          {report.error instanceof Error ? report.error.message : "Could not load the report."}
        </p>
      ) : !ready || !report.data ? (
        <div role="status" aria-label="Loading report" className="space-y-3 p-6">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <Report
          report={report.data}
          money={money}
          graphBy={graphBy}
          onGraphBy={setGraphBy}
          adGroupName={(id) => (id ? sourceNames.get(id) ?? "" : "")}
          stale={report.isPlaceholderData}
        />
      )}
    </div>
  );
}

function Report({
  report,
  money,
  graphBy,
  onGraphBy,
  adGroupName,
  stale,
}: {
  report: CallTrackingReport;
  money: boolean;
  graphBy: GraphBy;
  onGraphBy: (g: GraphBy) => void;
  adGroupName: (id?: string) => string;
  stale: boolean;
}) {
  const c = report.cards;
  const withRevenue = money && c.revenue !== undefined;
  return (
    <div className={`flex flex-col gap-4 p-6 ${stale ? "opacity-60" : ""}`} aria-busy={stale || undefined}>
      {report.atLeast && (
        <p role="status" className="text-sm text-muted-foreground">
          The period is too long to read in one go — these numbers are a floor.
        </p>
      )}
      <div role="group" aria-label="Report totals" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Kpi label="Incoming calls" value={c.incomingCalls.toLocaleString("en-US")} />
        <Kpi label="Callers" value={c.callers.toLocaleString("en-US")} />
        <Kpi label="Missed calls" value={c.missedCalls.toLocaleString("en-US")} />
        <Kpi label="Top Flow" value={c.topFlow ?? "N/A"} title={c.topFlow ?? undefined} />
        <Kpi label="Avg Duration" value={cardDuration(c.avgDurationSeconds)} />
        <Kpi label="Conversion" value={pct(c.conversion)} />
        {withRevenue && <Kpi label="Revenue" value={usd(c.revenue)} />}
      </div>

      <Card className="px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Calls by call flow</h2>
          <div role="radiogroup" aria-label="Graph step" className="inline-flex overflow-hidden rounded-md border text-sm">
            {GRAPH_STEPS.map((g) => (
              <button
                key={g}
                type="button"
                role="radio"
                aria-checked={graphBy === g}
                onClick={() => onGraphBy(g)}
                className={`px-3 py-1 ${graphBy === g ? "bg-muted font-medium" : "hover:bg-muted/50"}`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
        <LineChart
          title="Calls per call flow"
          days={report.graph.buckets}
          series={report.graph.series.map((s) => ({ name: s.name, values: s.counts }))}
          labelOf={(b) => bucketLabel(report.graph.graphBy, b)}
        />
      </Card>

      {/* A new window or grouping starts the table over: first page, server order. */}
      <TrackingTable
        key={`${report.groupBy}:${report.from}:${report.to}`}
        report={report}
        money={withRevenue}
        adGroupName={adGroupName}
      />
    </div>
  );
}

function Kpi({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <Card size="sm" className="px-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-xl font-semibold" title={title ?? value}>
          {value}
        </span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
    </Card>
  );
}

function TrackingTable({
  report,
  money,
  adGroupName,
}: {
  report: CallTrackingReport;
  money: boolean;
  adGroupName: (id?: string) => string;
}) {
  const [sort, setSort] = useState<{ by: CallTrackingColumn; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(1);

  const columns = callTrackingColumns(report.groupBy, money);
  const sorted = sortTrackingRows(report.rows, sort, adGroupName);
  const view = paginate(sorted, page, CALL_TRACKING_PAGE_SIZE);
  const toggle = (by: CallTrackingColumn, numeric: boolean) =>
    setSort((cur) =>
      cur?.by === by ? { by, dir: cur.dir === "desc" ? "asc" : "desc" } : { by, dir: numeric ? "desc" : "asc" },
    );

  if (!report.rows.length) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No calls in this period.</p>;
  }

  const cell = (key: CallTrackingColumn, r: CallTrackingReport["rows"][number]): string => {
    switch (key) {
      case "name":
        return r.name || "—";
      case "adGroup":
        return adGroupName(r.adGroupId);
      case "avgDurationSeconds":
        return rowDuration(r.avgDurationSeconds);
      case "jobsConversionRate":
      case "leadsConversionRate":
        return pct(r[key]);
      case "revenue":
        return usd(r.revenue);
      default:
        return (r[key] as number).toLocaleString("en-US");
    }
  };

  const from = view.total ? (view.page - 1) * CALL_TRACKING_PAGE_SIZE + 1 : 0;
  const to = Math.min(view.page * CALL_TRACKING_PAGE_SIZE, view.total);

  return (
    <div className="flex flex-col">
      <div className="overflow-x-auto rounded-md border">
        <table aria-label="Call Tracking" className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className="px-3 py-2 text-left font-medium whitespace-nowrap"
                  aria-sort={sort?.by === col.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <button type="button" className="hover:underline" onClick={() => toggle(col.key, col.numeric)}>
                    {col.label}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <tr key={r.key || "none"} className="border-t odd:bg-muted/40">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-3 py-2 ${col.numeric ? "tabular-nums" : "max-w-56 truncate"}`}
                    title={col.numeric ? undefined : cell(col.key, r)}
                  >
                    {cell(col.key, r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-1 py-3 text-xs text-muted-foreground">
        <span className="tabular-nums">
          Showing {from} to {to} of {view.total.toLocaleString("en-US")} results
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={view.page <= 1} onClick={() => setPage(view.page - 1)}>
            <ChevronLeft />
          </Button>
          <span className="tabular-nums">
            Page {view.page} of {view.pages}
          </span>
          <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={view.page >= view.pages} onClick={() => setPage(view.page + 1)}>
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
