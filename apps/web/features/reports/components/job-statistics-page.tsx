"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Download } from "lucide-react";
import {
  JOB_STATISTICS_BY_LABEL,
  type JobStatistics,
  type JobStatisticsBy,
  type JobStatisticsRow,
  type JobStatisticsTab,
  type JobStatisticsTable,
  type JobStatisticsTotals,
} from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { WzTabBar } from "@/components/workiz/tab-bar";
import { WzButtonGroup } from "@/components/workiz/button-group";
import { WzLegacySelect } from "@/components/workiz/legacy-select";
import { WzPeriodPicker } from "@/components/workiz/period-picker";
import { WzTagFilter } from "@/components/workiz/tag-filter";
import { WzStatList } from "@/components/workiz/stat-list";
import { WzBarChart, WzPieChart } from "@/components/workiz/charts";
import { WzDataTable } from "@/components/workiz/data-table";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useDenied } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { useJobTags } from "@/features/job-tags/hooks";
import { activeJobTags, tagSolidClasses } from "@/features/job-tags/lib";
import { useServiceAreas } from "@/features/service-areas/hooks";
import { accountToday } from "../jobs/lib";
import { legacyPresetRange, type LegacyReportPreset } from "../legacy-presets";
import { useJobStatistics } from "../job-statistics/hooks";
import {
  DEFAULT_SORT,
  DEFAULT_STATISTICS_BY,
  DEFAULT_STATISTICS_PRESET,
  STATISTICS_PRESETS,
  cellText,
  cellValue,
  columnsFor,
  groupSeries,
  nextSort,
  pieSlices,
  rowName,
  searchRows,
  seriesLabel,
  sortRows,
  sourcesOf,
  statisticsParams,
  tableCsv,
  wzMoney,
  type AreaDrill,
  type ColumnKey,
  type Grain,
  type SourceType,
  type StatisticsColumn,
  type TableSort,
} from "../job-statistics/lib";

const ALL = "";
const BY_TIME: JobStatisticsBy[] = ["created", "scheduled", "end"];

type View = "overview" | JobStatisticsTab;

const TAB_LABEL: Record<JobStatisticsTab, string> = {
  sources: "Sources",
  tech: "Tech Performance",
  area: "Area Performance",
  dispatcher: "Dispatcher Performance",
  jobTypes: "Job Types",
};

/** The second pie's title: Sources says "By Done Jobs", Tech and Dispatcher "By Jobs Done" (Workiz's own words). */
const DONE_PIE: Record<Exclude<JobStatisticsTab, "area">, string> = {
  sources: "By Done Jobs",
  tech: "By Jobs Done",
  dispatcher: "By Jobs Done",
  jobTypes: "By Done Jobs",
};

const SOURCE_TYPES: { value: SourceType; label: string }[] = [
  { value: "all", label: "All sources" },
  { value: "ad", label: "Only Ad sources" },
  { value: "external", label: "Only referrals" },
];

/**
 * Workiz's Job Statistics (`/root/statistics_report/`, the legacy page it
 * iframes; captures rep_jobstats_wz_*), 1:1: no heading (the breadcrumb names
 * it), the service area select and every tag on the left, the period box and
 * "By Time: Created | Scheduled | Closed" on the right, then the tabs — Jobs
 * overview (two bar charts and six figures), Sources, Tech, Area, Dispatcher
 * (two pies and a DataTables grid with Totals) and BitCRM's Job Types.
 *
 * The server does every sum (`GET /deals/report/statistics`) on the period's
 * jobs by the chosen date (Closed = the visit's end, the default) and leaves
 * out what the caller may not see: money without `financials.view`, profit
 * without View Profit, a tab without its grant. Days are the account's
 * calendar (Eastern).
 */
export function JobStatisticsPage({
  today: todayProp,
}: { today?: string } = {}) {
  const denied = useDenied();
  // The presets count from today on the account's calendar, not the viewer's.
  const [today] = useState(() => todayProp ?? accountToday());
  const [by, setBy] = useState<JobStatisticsBy>(DEFAULT_STATISTICS_BY);
  const [preset, setPreset] = useState<LegacyReportPreset>(
    DEFAULT_STATISTICS_PRESET,
  );
  const [custom, setCustom] = useState<{ from: string; to: string }>({
    from: today,
    to: today,
  });
  const [serviceAreaId, setServiceAreaId] = useState(ALL);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [view, setView] = useState<View>("overview");
  const [sourceType, setSourceType] = useState<SourceType>("all");
  const [drill, setDrill] = useState<AreaDrill>("metro");
  const [areaSearch, setAreaSearch] = useState("");
  const [sorts, setSorts] = useState<Record<string, TableSort | null>>({});
  // The legacy page's own presets: "Last N days" end yesterday (not the Jobs report's rules).
  const range = legacyPresetRange(preset, today) ?? custom;

  const stats = useJobStatistics(
    statisticsParams({
      by,
      from: range.from,
      to: range.to,
      ...(serviceAreaId !== ALL && { serviceAreaId }),
      ...(tagIds.length > 0 && { tagIds }),
    }),
  );
  const areasQuery = useServiceAreas();
  const tagsQuery = useJobTags();
  const areas = (areasQuery.data ?? [])
    .filter((a) => a.active)
    .sort((a, b) => a.name.localeCompare(b.name));
  const tags = activeJobTags(tagsQuery.data);
  // The filters, the tags and the figures come together, so nothing jumps.
  const ready = usePageReady([stats, areasQuery, tagsQuery].every(settled));

  if (denied("reports", "view")) return <NoAccess entity="reports" />;

  const toggleTag = (id: string) =>
    setTagIds((cur) =>
      cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id],
    );
  // Custom keeps the days on show until both of its days are picked (Workiz).
  const pickPreset = (p: LegacyReportPreset) => {
    if (p === "custom") setCustom(range);
    setPreset(p);
  };

  const data = stats.data;
  const tabs: View[] = ["overview", ...(data?.access.tabs ?? [])];
  const open: View = tabs.includes(view) ? view : "overview";
  const table =
    data && open !== "overview"
      ? tableView(data, open, {
          sourceType,
          drill,
          search: areaSearch,
          sort: sorts[tableKey(open, drill)],
        })
      : null;

  const exportCsv = () => {
    if (!table || typeof URL.createObjectURL !== "function") return;
    const blob = new Blob(
      [tableCsv(table.columns, table.rows, table.totals, table.nameOf)],
      { type: "text/csv" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `statistics_${open}${open === "area" ? `_${drill}` : ""}_${data!.window.from}_${data!.window.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    // Workiz's report is a grey page iframed 14px under a white breadcrumb strip.
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-background pt-3.5 text-wz-strong">
      <h1 className="sr-only">Job Statistics</h1>
      <div className="flex flex-1 flex-col bg-muted pb-5">
        {!ready ? (
          // One block for the filters, the tags and the figures while any is on its way.
          <div
            role="status"
            aria-label="Loading report"
            className="space-y-3 px-5"
          >
            <Skeleton className="h-8 w-[244px]" />
            <Skeleton className="h-64 w-1/2" />
            <Skeleton className="h-[480px] w-full" />
          </div>
        ) : (
          <>
            {/* Workiz's picker_holder: left half area + tags (+ source type, Export List), right half the period and By Time. */}
            <div className="flex items-start">
              <div className="w-1/2 min-w-0 pr-5 pb-6 pl-5">
                <WzLegacySelect
                  aria-label="Service area"
                  searchable
                  className="w-[244px]"
                  options={[
                    { value: ALL, label: "All Service Areas" },
                    ...areas.map((a) => ({ value: a.id, label: a.name })),
                  ]}
                  value={serviceAreaId}
                  onChange={setServiceAreaId}
                />
                <WzTagFilter
                  className="mt-[5px]"
                  tags={tags.map((t) => ({
                    id: t.id,
                    name: t.name,
                    className: tagSolidClasses(t.color),
                  }))}
                  selected={tagIds}
                  onToggle={toggleTag}
                  after={
                    open === "sources" ? (
                      <WzLegacySelect
                        aria-label="Source type"
                        className="mt-[5px] ml-5 w-[178px]"
                        options={SOURCE_TYPES}
                        value={sourceType}
                        onChange={(v) => setSourceType(v as SourceType)}
                      />
                    ) : null
                  }
                />
                {table ? (
                  <button
                    type="button"
                    onClick={exportCsv}
                    // #ffd400 / #eac300: a.button#xls_export at rest and hovered (rep_jobstats_wz_10_sources, _10_export_hover).
                    className="mt-4 -mb-1 inline-flex h-8 cursor-pointer items-center gap-[7px] rounded-[15px] bg-[#ffd400] px-[15px] text-[13px] leading-8 font-semibold tracking-[0.5px] text-wz-strong outline-none hover:bg-wz-primary-hover focus-visible:ring-2 focus-visible:ring-wz-strong"
                  >
                    <Download
                      aria-hidden
                      className="size-3.5"
                      strokeWidth={2.25}
                    />
                    Export List
                  </button>
                ) : null}
              </div>
              <div className="flex w-1/2 min-w-0 flex-col items-end pr-5">
                <WzPeriodPicker
                  presets={STATISTICS_PRESETS}
                  preset={preset}
                  range={range}
                  onPresetChange={pickPreset}
                  onCustomChange={setCustom}
                  today={today}
                />
                <div className="mt-[18px] flex items-center gap-[3px]">
                  <span className="text-sm leading-[34px] tracking-[0.4px]">
                    By Time:
                  </span>
                  <WzButtonGroup
                    aria-label="By Time"
                    options={BY_TIME.map((b) => ({
                      value: b,
                      label: JOB_STATISTICS_BY_LABEL[b],
                    }))}
                    value={by}
                    onChange={setBy}
                  />
                </div>
              </div>
            </div>

            {stats.error ? (
              <p role="alert" className="px-5 pb-5 text-sm text-destructive">
                {stats.error instanceof Error
                  ? stats.error.message
                  : "Could not load the report."}
              </p>
            ) : !data ? (
              <div role="status" aria-label="Loading report" className="px-5">
                <Skeleton className="h-[480px] w-full" />
              </div>
            ) : (
              <>
                <div className="pt-4">
                  <WzTabBar
                    variant="legacy"
                    aria-label="Job Statistics"
                    className="relative z-10 -mb-px"
                    tabs={tabs.map((t) => ({
                      value: t,
                      label: t === "overview" ? "Jobs overview" : TAB_LABEL[t],
                    }))}
                    value={open}
                    onValueChange={(v) => setView(v as View)}
                  />
                </div>
                <div
                  role="tabpanel"
                  aria-label={
                    open === "overview" ? "Jobs overview" : TAB_LABEL[open]
                  }
                  className="border border-input bg-background"
                >
                  {open === "overview" ? (
                    <Overview stats={data} />
                  ) : table ? (
                    <Breakdown
                      tab={open}
                      stats={data}
                      table={table}
                      drill={drill}
                      onDrill={setDrill}
                      search={areaSearch}
                      onSearch={setAreaSearch}
                      onSort={(key) =>
                        setSorts((cur) => {
                          const k = tableKey(open, drill);
                          return {
                            ...cur,
                            [k]: nextSort(
                              cur[k] === undefined ? defaultSort(open) : cur[k],
                              key,
                            ),
                          };
                        })
                      }
                    />
                  ) : null}
                </div>
                <Notes stats={data} view={open} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- overview */

const BLUE = "54, 162, 235";
const RED = "255, 99, 132";

/** Workiz's Jobs overview: Day | Week | Month over two 300px bar charts, the six figures on the right. */
function Overview({ stats }: { stats: JobStatistics }) {
  const [grain, setGrain] = useState<Grain>("day");
  const { money, profit } = stats.access;
  const k = stats.kpis;
  const series = groupSeries(stats.series, grain);
  const labels = series.map((d) => seriesLabel(d.date, grain));
  const figures = [
    { key: "done", value: String(k.done), caption: ["Jobs", "Done"] as const },
    {
      key: "submitted",
      value: String(k.submitted),
      caption: ["Jobs", "Submitted"] as const,
    },
    {
      key: "progress",
      value: String(k.inProgress),
      caption: ["Jobs", "In Progress"] as const,
    },
    {
      key: "canceled",
      value: String(k.canceled),
      caption: ["Jobs", "Canceled"] as const,
    },
    ...(money
      ? [
          {
            key: "gross",
            value: wzMoney(k.gross),
            caption: ["Total", "Sales"] as const,
          },
        ]
      : []),
    ...(money && profit
      ? [
          {
            key: "net",
            value: wzMoney(k.profit),
            caption: ["Total", "Profit"] as const,
          },
        ]
      : []),
  ];

  return (
    <div className="flex items-start">
      <div className="relative w-[74.36%] shrink-0">
        <WzButtonGroup
          aria-label="Group by"
          className="absolute top-[31px] right-[45px]"
          options={[
            { value: "day", label: "Day" },
            { value: "week", label: "Week" },
            { value: "month", label: "Month" },
          ]}
          value={grain}
          onChange={setGrain}
        />
        <div className="mt-[45px] p-2.5">
          <WzBarChart
            aria-label="Jobs and Canceled"
            labels={labels}
            series={[
              { label: "Jobs", values: series.map((d) => d.jobs), color: BLUE },
              {
                label: "Canceled",
                values: series.map((d) => d.canceled),
                color: RED,
              },
            ]}
          />
        </div>
        {money ? (
          <div className="p-2.5">
            <WzBarChart
              aria-label={profit ? "Sales and Profit" : "Sales"}
              labels={labels}
              series={[
                {
                  label: "Sales",
                  values: series.map((d) => d.sales ?? 0),
                  color: BLUE,
                },
                ...(profit
                  ? [
                      {
                        label: "Profit",
                        values: series.map((d) => d.profit ?? 0),
                        color: RED,
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        ) : null}
      </div>
      <WzStatList
        aria-label="Totals"
        className="mt-4 ml-[2.34%] w-[23.26%]"
        items={figures}
      />
    </div>
  );
}

/* -------------------------------------------------------------- breakdowns */

interface TableView {
  columns: StatisticsColumn[];
  rows: JobStatisticsRow[];
  totals: JobStatisticsTotals;
  /** All the table's rows, for the pies (a search narrows the grid, not the pies). */
  all: JobStatisticsRow[];
  nameOf: (r: JobStatisticsRow) => string;
  sort: TableSort | null;
}

const tableKey = (tab: JobStatisticsTab, drill: AreaDrill) =>
  tab === "area" ? `area:${drill}` : tab;

/** DataTables opens on the first column, A to Z; Area's first column is the hidden Zip, so its grid shows no sorted column. */
const defaultSort = (tab: JobStatisticsTab): TableSort | null =>
  tab === "area" ? null : DEFAULT_SORT;

function tableView(
  stats: JobStatistics,
  tab: JobStatisticsTab,
  o: {
    sourceType: SourceType;
    drill: AreaDrill;
    search: string;
    sort: TableSort | null | undefined;
  },
): TableView | null {
  const source: JobStatisticsTable | undefined =
    tab === "sources"
      ? stats.sources && sourcesOf(stats.sources, o.sourceType)
      : tab === "area"
        ? stats.area?.[o.drill]
        : stats[tab];
  if (!source) return null;
  const nameOf = (r: JobStatisticsRow) => rowName(tab, r, o.drill);
  const sort = o.sort === undefined ? defaultSort(tab) : o.sort;
  const searched =
    tab === "area" ? searchRows(source.rows, o.search, nameOf) : source.rows;
  const rows = sortRows(
    searched,
    sort?.key ?? "name",
    sort?.dir ?? "asc",
    nameOf,
  );
  return {
    columns: columnsFor(tab, o.drill, stats.access),
    rows,
    totals: source.totals,
    all: source.rows,
    nameOf,
    sort,
  };
}

const twoDecimals = (v: number) => v.toFixed(2);

function Breakdown({
  tab,
  stats,
  table,
  drill,
  onDrill,
  search,
  onSearch,
  onSort,
}: {
  tab: JobStatisticsTab;
  stats: JobStatistics;
  table: TableView;
  drill: AreaDrill;
  onDrill: (d: AreaDrill) => void;
  search: string;
  onSearch: (q: string) => void;
  onSort: (key: ColumnKey) => void;
}) {
  const title = TAB_LABEL[tab];
  const bareCounts = tab !== "area";
  const nameCols = useMemo(
    () =>
      new Set(
        table.columns.filter((c) => c.format === "text").map((c) => c.key),
      ),
    [table.columns],
  );

  return (
    <div>
      {tab === "area" ? (
        <div className="px-5 pt-5 pb-[18px]">
          <WzButtonGroup
            aria-label="Drill by"
            options={[
              { value: "metro", label: "Metro" },
              { value: "city", label: "City" },
              { value: "zip", label: "Zip" },
            ]}
            value={drill}
            onChange={onDrill}
          />
        </div>
      ) : (
        <div className="flex justify-between pt-5 pb-[25px]">
          {stats.access.money ? (
            <PieColumn title="By Sales Amount">
              <WzPieChart
                aria-label={`${title} by sales amount`}
                slices={pieSlices(table.all, "gross", table.nameOf)}
                format={twoDecimals}
              />
            </PieColumn>
          ) : null}
          <PieColumn
            title={DONE_PIE[tab]}
            className={stats.access.money ? undefined : "mx-auto"}
          >
            <WzPieChart
              aria-label={`${title} by done jobs`}
              slices={pieSlices(table.all, "done", table.nameOf)}
            />
          </PieColumn>
        </div>
      )}
      <WzDataTable
        aria-label={title}
        columns={table.columns.map((c) => ({ key: c.key, label: c.label }))}
        rows={table.rows.map((r) => ({
          key: r.key,
          cells: table.columns.map((c) =>
            cellText(cellValue(r, c.key, table.nameOf(r)), c.format),
          ),
        }))}
        footer={table.columns.map((c, i) =>
          nameCols.has(c.key)
            ? i === 0
              ? "Totals:"
              : ""
            : cellText(
                table.totals[c.key as keyof JobStatisticsTotals],
                c.format,
                {
                  bareCounts:
                    bareCounts &&
                    (c.key === "all" || c.key === "done" || c.key === "open"),
                },
              ),
        )}
        sort={table.sort}
        onSort={(key) => onSort(key as ColumnKey)}
        search={
          tab === "area" ? { value: search, onChange: onSearch } : undefined
        }
      />
    </div>
  );
}

/** A pie's half of the row: its 20px/25px title centred, 20px over the chart (h3.dash-header). */
function PieColumn({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`w-[48.86%] ${className ?? ""}`}>
      <h3 className="mb-5 text-center text-xl leading-[25px] font-normal text-wz-tab-bar capitalize">
        {title}
      </h3>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ notes */

/**
 * BitCRM's own notes, which Workiz has no place for: what the server could
 * not count, where profit came from, the jobs without a service area. Small
 * grey lines under the box, like Workiz's table footnotes.
 */
function Notes({ stats, view }: { stats: JobStatistics; view: View }) {
  const lines: string[] = [...stats.warnings];
  if (
    view === "overview" &&
    stats.profitSources &&
    stats.profitSources.computed > 0
  ) {
    lines.push(
      `Profit: ${stats.profitSources.workiz.toLocaleString("en-US")} Done jobs carry Workiz's own figure, ${stats.profitSources.computed.toLocaleString("en-US")} were computed with the Workiz commission formula.`,
    );
  }
  const without = stats.area?.withoutArea ?? 0;
  if (view === "area" && without > 0) {
    lines.push(
      `${without.toLocaleString("en-US")} job${without === 1 ? "" : "s"} without a service area ${without === 1 ? "is" : "are"} in none of these rows, as in Workiz.`,
    );
  }
  if (!lines.length) return null;
  return (
    <ul role="status" className="px-5 py-2.5 text-xs leading-4 text-wz-text">
      {lines.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}
