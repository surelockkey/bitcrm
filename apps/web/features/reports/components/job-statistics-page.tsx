"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Download, Search } from "lucide-react";
import {
  JOB_STATISTICS_BY_LABEL,
  type JobStatistics,
  type JobStatisticsBy,
  type JobStatisticsRow,
  type JobStatisticsTab,
  type JobStatisticsTable,
} from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DateTimeRangePicker } from "@/components/ui/date-time-range-picker";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DAY_END, DAY_START, toIsoInstant, toLocalParts } from "@/lib/date-range";
import { useDenied } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { useJobTags } from "@/features/job-tags/hooks";
import { activeJobTags } from "@/features/job-tags/lib";
import { useServiceAreas } from "@/features/service-areas/hooks";
import { DailyChart } from "@/features/dashboard/components/daily-chart";
import { SharePie } from "@/features/dashboard/components/share-pie";
import { compactMoney } from "@/features/dashboard/lib";
import { accountToday, presetRange, type JobsReportPreset } from "../jobs/lib";
import { useJobStatistics } from "../job-statistics/hooks";
import {
  DEFAULT_STATISTICS_BY,
  DEFAULT_STATISTICS_PRESET,
  STATISTICS_PRESETS,
  cellValue,
  columnsFor,
  groupSeries,
  pieOf,
  rowName,
  searchRows,
  sortRows,
  sourcesOf,
  statisticsParams,
  tableCsv,
  type AreaDrill,
  type ColumnKey,
  type Grain,
  type SourceType,
  type StatisticsColumn,
} from "../job-statistics/lib";

const ALL = "__all__";
const BY_TIME: JobStatisticsBy[] = ["created", "scheduled", "end"];

const money2 = (n?: number): string =>
  `$${(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const grainLabel = (grain: Grain) => (date: string): string => {
  const d = new Date(`${date}T00:00:00Z`);
  return grain === "month"
    ? d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

const TAB_LABEL: Record<JobStatisticsTab, string> = {
  sources: "Sources",
  tech: "Tech Performance",
  area: "Area Performance",
  dispatcher: "Dispatcher Performance",
  jobTypes: "Job Types",
};

/**
 * Workiz's Job Statistics (`/root/statistics_report/`): a period's jobs on
 * the date chosen under "By Time" — Created, Scheduled, or Closed (the
 * visit's end, the default) — as six KPIs and two day charts, and per
 * source, tech, area, dispatcher and job type. The server does every sum
 * (`GET /deals/report/statistics`) and leaves out what the caller may not
 * see: money without `financials.view`, profit without View Profit, a tab
 * without its grant. Days are the account's calendar (Eastern).
 */
export function JobStatisticsPage({ today: todayProp }: { today?: string } = {}) {
  const denied = useDenied();
  // The presets count from today on the account's calendar, not the viewer's.
  const [today] = useState(() => todayProp ?? accountToday());
  const [by, setBy] = useState<JobStatisticsBy>(DEFAULT_STATISTICS_BY);
  const [preset, setPreset] = useState<JobsReportPreset>(DEFAULT_STATISTICS_PRESET);
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: today, to: today });
  const [serviceAreaId, setServiceAreaId] = useState(ALL);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const range = preset === "custom" ? custom : presetRange(preset, today);

  const stats = useJobStatistics(
    statisticsParams({
      by,
      from: range.from,
      to: range.to,
      ...(serviceAreaId !== ALL && { serviceAreaId }),
      ...(tagIds.length > 0 && { tagIds }),
    }),
  );
  const areas = (useServiceAreas().data ?? []).filter((a) => a.active).sort((a, b) => a.name.localeCompare(b.name));
  const tags = activeJobTags(useJobTags().data);

  if (denied("reports", "view")) return <NoAccess entity="reports" />;

  const toggleTag = (id: string) => setTagIds((cur) => (cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]));

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-6">
        <h1 className="text-lg font-semibold tracking-tight">Job Statistics</h1>
      </div>

      {/* Workiz's filter bar: area, By Time, the period. */}
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6">
        <select
          aria-label="Service area"
          className="h-9 rounded-md border bg-transparent px-2 text-sm"
          value={serviceAreaId}
          onChange={(e) => setServiceAreaId(e.target.value)}
        >
          <option value={ALL}>All Service Areas</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <div role="radiogroup" aria-label="By Time" className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">By Time:</span>
          {BY_TIME.map((b) => (
            <label key={b} className="flex items-center gap-1.5">
              <input type="radio" name="by-time" checked={by === b} onChange={() => setBy(b)} />
              {JOB_STATISTICS_BY_LABEL[b]}
            </label>
          ))}
        </div>
        <span className="flex-1" />
        <select
          aria-label="Date preset"
          className="h-9 rounded-md border bg-transparent px-2 text-sm"
          value={preset}
          onChange={(e) => setPreset(e.target.value as JobsReportPreset)}
        >
          {STATISTICS_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <DateTimeRangePicker
          dateOnly
          label="Days"
          value={{ from: toIsoInstant(range.from, DAY_START), to: toIsoInstant(range.to, DAY_END) }}
          onChange={(r) => {
            const from = toLocalParts(r.from)?.date ?? range.from;
            setCustom({ from, to: toLocalParts(r.to)?.date ?? from });
            setPreset("custom");
          }}
        />
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2 sm:px-6" aria-label="Tags">
          <span className="mr-1 text-xs text-muted-foreground">Tags:</span>
          <TagChip label="All" pressed={tagIds.length === 0} onClick={() => setTagIds([])} />
          {tags.map((t) => (
            <TagChip key={t.id} label={t.name} pressed={tagIds.includes(t.id)} onClick={() => toggleTag(t.id)} />
          ))}
        </div>
      )}

      {stats.error ? (
        <p role="alert" className="p-6 text-sm text-destructive">
          {stats.error instanceof Error ? stats.error.message : "Could not load the report."}
        </p>
      ) : !stats.data ? (
        <div role="status" aria-label="Loading report" className="space-y-3 p-6">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <Report stats={stats.data} />
      )}
    </div>
  );
}

function TagChip({ label, pressed, onClick }: { label: string; pressed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`rounded-chip border px-2.5 py-0.5 text-xs ${pressed ? "border-brand bg-accent" : "border-border"}`}
    >
      {label}
    </button>
  );
}

function Report({ stats }: { stats: JobStatistics }) {
  const [grain, setGrain] = useState<Grain>("day");
  const { money, profit } = stats.access;
  const k = stats.kpis;
  const series = groupSeries(stats.series, grain);

  return (
    <div className="flex flex-col gap-3 p-4 sm:p-6">
      {stats.warnings.length > 0 && (
        <ul role="status" className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
          {stats.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Jobs overview</TabsTrigger>
          {stats.access.tabs.map((t) => (
            <TabsTrigger key={t} value={t}>
              {TAB_LABEL[t]}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-4 pt-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Jobs Done" value={k.done} />
            <Kpi label="Jobs Submitted" value={k.submitted} />
            <Kpi label="Jobs In Progress" value={k.inProgress} />
            <Kpi label="Jobs Canceled" value={k.canceled} />
            {money && <Kpi label="Total Sales" value={money2(k.gross)} />}
            {money && profit && <Kpi label="Total Profit" value={money2(k.profit)} />}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Group by</span>
            <select
              aria-label="Group by"
              className="h-8 rounded-md border bg-transparent px-2 text-sm"
              value={grain}
              onChange={(e) => setGrain(e.target.value as Grain)}
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="px-4">
              <h2 className="text-base font-semibold">Jobs</h2>
              <DailyChart
                title="Jobs and canceled"
                series={[
                  { label: "Jobs", className: "bg-brand" },
                  { label: "Canceled", className: "bg-chart2" },
                ]}
                days={series.map((d) => ({ date: d.date, values: [d.jobs, d.canceled] }))}
                format={(v) => v.toLocaleString("en-US")}
                labelOf={grainLabel(grain)}
              />
            </Card>
            {money && (
              <Card className="px-4">
                <h2 className="text-base font-semibold">Sales</h2>
                <DailyChart
                  title={profit ? "Sales and profit" : "Sales"}
                  series={[
                    { label: "Sales", className: "bg-brand" },
                    ...(profit ? [{ label: "Profit", className: "bg-chart2" }] : []),
                  ]}
                  days={series.map((d) => ({ date: d.date, values: profit ? [d.sales ?? 0, d.profit ?? 0] : [d.sales ?? 0] }))}
                  format={compactMoney}
                  labelOf={grainLabel(grain)}
                />
              </Card>
            )}
          </div>
          {stats.profitSources && stats.profitSources.computed > 0 && (
            <p className="text-xs text-muted-foreground">
              Profit: {stats.profitSources.workiz.toLocaleString("en-US")} Done jobs carry Workiz&apos;s own figure,{" "}
              {stats.profitSources.computed.toLocaleString("en-US")} were computed with the Workiz commission formula.
            </p>
          )}
        </TabsContent>

        {stats.sources && (
          <TabsContent value="sources" className="pt-4">
            <SourcesTab table={stats.sources} stats={stats} />
          </TabsContent>
        )}
        {stats.tech && (
          <TabsContent value="tech" className="pt-4">
            <Breakdown tab="tech" table={stats.tech} stats={stats} pies />
          </TabsContent>
        )}
        {stats.area && (
          <TabsContent value="area" className="pt-4">
            <AreaTab stats={stats} />
          </TabsContent>
        )}
        {stats.dispatcher && (
          <TabsContent value="dispatcher" className="pt-4">
            <Breakdown tab="dispatcher" table={stats.dispatcher} stats={stats} pies />
          </TabsContent>
        )}
        {stats.jobTypes && (
          <TabsContent value="jobTypes" className="pt-4">
            <Breakdown tab="jobTypes" table={stats.jobTypes} stats={stats} pies />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <Card size="sm" className="px-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-2xl font-semibold tabular-nums">{typeof value === "number" ? value.toLocaleString("en-US") : value}</span>
      </div>
    </Card>
  );
}

function SourcesTab({ table, stats }: { table: JobStatisticsTable; stats: JobStatistics }) {
  const [type, setType] = useState<SourceType>("all");
  return (
    <Breakdown
      tab="sources"
      table={sourcesOf(table, type)}
      stats={stats}
      pies
      toolbar={
        <select
          aria-label="Source type"
          className="h-8 rounded-md border bg-transparent px-2 text-sm"
          value={type}
          onChange={(e) => setType(e.target.value as SourceType)}
        >
          <option value="all">All sources</option>
          <option value="ad">Only Ad sources</option>
          <option value="external">Only referrals</option>
        </select>
      }
    />
  );
}

function AreaTab({ stats }: { stats: JobStatistics }) {
  const [drill, setDrill] = useState<AreaDrill>("metro");
  const [search, setSearch] = useState("");
  const area = stats.area!;
  const without = area.withoutArea;
  return (
    <Breakdown
      key={drill}
      tab="area"
      drill={drill}
      table={area[drill]}
      stats={stats}
      search={search}
      footnote={
        without > 0
          ? `${without.toLocaleString("en-US")} job${without === 1 ? "" : "s"} without a service area ${without === 1 ? "is" : "are"} in none of these rows, as in Workiz.`
          : undefined
      }
      toolbar={
        <>
          <div role="radiogroup" aria-label="Drill by" className="flex gap-3 text-sm">
            {(["metro", "city", "zip"] as AreaDrill[]).map((a) => (
              <label key={a} className="flex items-center gap-1.5">
                <input type="radio" name="drill-by" checked={drill === a} onChange={() => setDrill(a)} />
                {a === "metro" ? "Metro" : a === "city" ? "City" : "Zip"}
              </label>
            ))}
          </div>
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search" className="h-8 pl-8" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </>
      }
    />
  );
}

function show(value: string | number | undefined, format: StatisticsColumn["format"]): string {
  if (format === "money") return money2(Number(value) || 0);
  if (format === "pct") return `${value ?? 0}%`;
  if (format === "count") return (Number(value) || 0).toLocaleString("en-US");
  return String(value ?? "");
}

const isText = (key: ColumnKey): boolean => key === "name" || key === "city" || key === "serviceArea";

/** One Workiz breakdown: its pies, a table sortable on any column with a Totals row, and Export List. */
function Breakdown({
  tab,
  drill = "metro",
  table,
  stats,
  pies = false,
  toolbar,
  search = "",
  footnote,
}: {
  tab: JobStatisticsTab;
  drill?: AreaDrill;
  table: JobStatisticsTable;
  stats: JobStatistics;
  pies?: boolean;
  toolbar?: ReactNode;
  search?: string;
  footnote?: string;
}) {
  const title = TAB_LABEL[tab];
  const [sort, setSort] = useState<{ key: ColumnKey; dir: "asc" | "desc" }>({ key: "all", dir: "desc" });
  const nameOf = useMemo(() => (r: JobStatisticsRow) => rowName(tab, r, drill), [tab, drill]);
  const columns = columnsFor(tab, drill, stats.access);
  const rows = sortRows(searchRows(table.rows, search, nameOf), sort.key, sort.dir, nameOf);

  const toggle = (key: ColumnKey) =>
    setSort((cur) => ({ key, dir: cur.key === key ? (cur.dir === "desc" ? "asc" : "desc") : isText(key) ? "asc" : "desc" }));

  const exportCsv = () => {
    if (typeof URL.createObjectURL !== "function") return;
    const blob = new Blob([tableCsv(columns, rows, table.totals, nameOf)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `statistics_${tab}${tab === "area" ? `_${drill}` : ""}_${stats.window.from}_${stats.window.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-3">
      {pies && (
        <div className="grid gap-4 md:grid-cols-2">
          {stats.access.money && (
            <Card className="px-4">
              <h2 className="text-sm font-semibold">By Sales Amount</h2>
              <SharePie title={`${title} by sales amount`} slices={pieOf(table.rows, "gross", nameOf)} valueText={money2} valueHeader="Sales" />
            </Card>
          )}
          <Card className="px-4">
            <h2 className="text-sm font-semibold">By Done Jobs</h2>
            <SharePie title={`${title} by done jobs`} slices={pieOf(table.rows, "done", nameOf)} />
          </Card>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {toolbar}
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
          <Download className="size-4" /> Export List
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No data found</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table aria-label={title} className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={`px-3 py-2 font-medium whitespace-nowrap ${c.format === "text" ? "text-left" : "text-right"}`}
                    aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button type="button" className="hover:underline" onClick={() => toggle(c.key)}>
                      {c.label}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t">
                  {columns.map((c) => (
                    <td key={c.key} className={`px-3 py-2 ${c.format === "text" ? "" : "text-right tabular-nums"}`}>
                      {show(cellValue(r, c.key, nameOf(r)), c.format)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted font-medium">
                {columns.map((c, i) => (
                  <td key={c.key} className={`px-3 py-2 ${c.format === "text" ? "" : "text-right tabular-nums"}`}>
                    {c.format === "text" ? (i === 0 ? "Totals:" : "") : show(table.totals[c.key as keyof typeof table.totals], c.format)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {footnote && <p className="text-xs text-muted-foreground">{footnote}</p>}
    </div>
  );
}
