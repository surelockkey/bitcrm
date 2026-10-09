"use client";

import { useMemo, useState } from "react";
import { CALL_TRACKING_MAX_DAYS, type CallTrackingGroupBy, type CallTrackingReport, type CallTrackingRow } from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { WzAreaChart } from "@/components/workiz/area-chart";
import { WzDateRangePicker, type WzDateRange } from "@/components/workiz/date-range-picker";
import { WzFlowViews } from "@/components/workiz/flow-views";
import { WzKpiCard, WzKpiCardSkeleton } from "@/components/workiz/kpi-card";
import { WzPager, type WzPagerState } from "@/components/workiz/pager";
import { WzReportGrid, wzNextSort, type WzReportColumn, type WzSortDir } from "@/components/workiz/report-grid";
import { WzSelect } from "@/components/workiz/select";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { useJobSources } from "@/features/job-sources/hooks";
import { paginate } from "../lib";
import { CALL_TRACKING_PRESETS, REPORT_PRESET_LABEL, reportPresetRange } from "../report-dates";
import { useCallTracking } from "../call-tracking/hooks";
import {
  CALL_TRACKING_PAGE_SIZE,
  callTrackingColumns,
  graphView,
  pct,
  rowDuration,
  seriesColor,
  sortTrackingRows,
  trackingCardFigures,
  usd,
  type CallTrackingColumn,
  type CallTrackingParams,
} from "../call-tracking/lib";

type GraphBy = CallTrackingParams["graphBy"];
const GRAPH_STEPS = (["hour", "day", "week", "month"] as const).map((g) => ({ value: g, label: g }));
const GROUP_BY = [
  { value: "flows", label: "By Call Flow" },
  { value: "numbers", label: "By Phone Number" },
];
const PRESETS = CALL_TRACKING_PRESETS.map((id) => ({ id, label: REPORT_PRESET_LABEL[id] }));
/** react-table's `width: 150` columns against everyone else's 100: 161px of 1400 (rep_calltracking_wz_01_default). */
const WIDE_COLUMN = 161;

const daysBetween = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;

/**
 * Workiz Reports → Call Tracking (`/root/callTrackingReport`), drawn as
 * Workiz draws it (rep_calltracking_wz_*): no title — "By Call Flow" at the
 * left and the date box at the right; seven cards; the hour | day | week |
 * month switch over the calls-per-flow graph and its legend; the table across
 * the page's whole width, twenty rows a page, sorted in the browser. Opens on
 * This month by call flow, hour by hour; the presets count from the viewer's
 * own today, "Last N days" including it (checked live 2026-10-09). Revenue
 * only with `financials.view` (the server leaves it out otherwise); the whole
 * report needs `calls.view` too — Workiz's "Call Reports" restriction.
 */
export function CallTrackingPage({ today }: { today: string }) {
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const money = can("financials");
  const blocked = denied("reports", "view") || denied("calls", "view");

  const [groupBy, setGroupBy] = useState<CallTrackingGroupBy>("flows");
  const [graphBy, setGraphBy] = useState<GraphBy>("hour");
  const [range, setRange] = useState<WzDateRange>(() => ({ preset: "this_month", ...reportPresetRange("this_month", today)! }));
  // Our server reads at most a year at a time; Workiz's own words for a box that asks more.
  const tooLong = daysBetween(range.from, range.to) > CALL_TRACKING_MAX_DAYS;

  const report = useCallTracking({ from: range.from, to: range.to, groupBy, graphBy }, !blocked && !tooLong);
  const sources = useJobSources();
  const sourceNames = useMemo(() => new Map((sources.data ?? []).map((s) => [s.id, s.name])), [sources.data]);
  // The report was drawn the moment it came: the ad groups' names (a catalog
  // sometimes seconds slow) filled the Ad group column in later, and with the
  // role still being read the Revenue card and column came a beat after. The
  // report comes with its names and its money.
  const ready = usePageReady(!permsLoading && [report, sources].every(settled));

  if (blocked) return <NoAccess entity="reports" />;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-background">
      <div className="flex items-start justify-between gap-4 px-5 pt-6">
        <WzSelect
          label="Group by"
          geometry="bare"
          className="w-[200px] shrink-0"
          options={GROUP_BY}
          value={groupBy}
          onChange={(v) => v && setGroupBy(v as CallTrackingGroupBy)}
        />
        <WzDateRangePicker
          presets={PRESETS}
          value={range}
          onChange={setRange}
          rangeOf={(id) => reportPresetRange(id as Parameters<typeof reportPresetRange>[0], today)}
          calendar={{ today }}
          customError={tooLong ? "Date range exceeds 12 months" : null}
          // Workiz's box is as wide as its words (228px for "This month"); Custom opens it to 362px.
          className={range.preset === "custom" ? undefined : "w-auto"}
        />
      </div>

      {tooLong ? null : report.error ? (
        <p role="alert" className="px-5 pt-5 text-sm text-destructive">
          {report.error instanceof Error ? report.error.message : "Could not load the report."}
        </p>
      ) : !ready || !report.data ? (
        <div role="status" aria-label="Loading report" className="mx-5 mt-5 flex flex-col">
          <div className="mb-5 flex py-[5px]">
            {Array.from({ length: 7 }, (_, i) => (
              <WzKpiCardSkeleton key={i} className="mr-[15px] max-w-[300px] min-w-[120px] flex-1 basis-0" />
            ))}
          </div>
          <Skeleton className="h-[272px] w-full" />
        </div>
      ) : (
        <Report
          report={report.data}
          money={money}
          graphBy={graphBy}
          onGraphBy={setGraphBy}
          adGroupName={(id) => (id ? (sourceNames.get(id) ?? "") : "")}
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
  const withRevenue = money && report.cards.revenue !== undefined;
  const hasRows = report.rows.some((r) => r.calls > 0);
  const figures = trackingCardFigures(report.cards, { hasRows, money: withRevenue });
  const graph = graphView(report.graph);
  return (
    <div className={stale ? "opacity-60" : undefined} aria-busy={stale || undefined}>
      <div className="mx-5 mt-5 mb-5">
        {report.atLeast && (
          <p role="status" className="mb-2.5 text-sm leading-4 text-wz-strong">
            The period is too long to read in one go — these numbers are a floor.
          </p>
        )}
        {/* cardsBar: seven cards sharing the row, 15px after each (the last too). */}
        <div role="group" aria-label="Report totals" className="flex py-[5px]">
          {figures.map((f) => (
            <WzKpiCard
              key={f.caption}
              size="cardsBar"
              value={f.value}
              caption={f.caption}
              label={f.caption}
              title={f.caption === "Top Flow" ? f.value : undefined}
              className="mr-[15px] max-w-[300px] min-w-[120px] flex-1 basis-0"
            />
          ))}
        </div>
        {graph.labels.length ? (
          <div className="mt-5">
            <div className="mr-[18px] mb-2.5 flex justify-end">
              <WzFlowViews aria-label="Graph step" options={GRAPH_STEPS} value={graphBy} onChange={onGraphBy} />
            </div>
            <WzAreaChart
              aria-label="Calls per call flow"
              labels={graph.labels}
              series={graph.series.map((s, i) => ({ ...s, color: seriesColor(i, s.label) }))}
            />
          </div>
        ) : null}
      </div>

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

function TrackingTable({
  report,
  money,
  adGroupName,
}: {
  report: CallTrackingReport;
  money: boolean;
  adGroupName: (id?: string) => string;
}) {
  // Workiz opens the table in the server's order (busiest first), no bar.
  const [sort, setSort] = useState<{ by: CallTrackingColumn; dir: WzSortDir } | null>(null);
  const [page, setPage] = useState(1);

  const sorted = sortTrackingRows(report.rows, sort, adGroupName);
  const view = paginate(sorted, page, CALL_TRACKING_PAGE_SIZE);
  const from = view.total ? (view.page - 1) * CALL_TRACKING_PAGE_SIZE + 1 : 1;
  const to = Math.min(view.page * CALL_TRACKING_PAGE_SIZE, view.total);
  const pager: WzPagerState = {
    page: view.page,
    from,
    to,
    total: view.total,
    totalPages: view.pages,
    canPrev: view.page > 1,
    canNext: view.page < view.pages,
    isFetching: false,
    prev: () => setPage(view.page - 1),
    next: () => setPage(view.page + 1),
  };

  const text = (key: CallTrackingColumn, r: CallTrackingRow): string => {
    switch (key) {
      case "name":
        return r.name;
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
        return String(r[key] ?? 0);
    }
  };

  const columns: WzReportColumn<CallTrackingRow>[] = callTrackingColumns(report.groupBy, money).map((c) => ({
    id: c.key,
    label: c.label,
    width: c.wide ? WIDE_COLUMN : undefined,
    sortable: true,
    cell: (r: CallTrackingRow) => {
      const t = text(c.key, r);
      return (
        <span className="block truncate" title={c.key === "name" || c.key === "adGroup" ? t : undefined}>
          {t}
        </span>
      );
    },
  }));

  return (
    <WzReportGrid
      aria-label="Call Tracking"
      columns={columns}
      rows={view.rows}
      rowKey={(r) => r.key || "none"}
      sort={sort ? { column: sort.by, dir: sort.dir } : null}
      onSort={(column) =>
        setSort((cur) => ({
          by: column as CallTrackingColumn,
          dir: wzNextSort(cur?.by === column ? cur.dir : undefined),
        }))
      }
      emptyText={null}
      footer={<WzPager pager={pager} plainNumbers />}
    />
  );
}
