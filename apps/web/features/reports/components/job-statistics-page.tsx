"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, Download } from "lucide-react";
import type { DealStats, DealStatsBucket, DealStatsBy } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DateTimeRangePicker } from "@/components/ui/date-time-range-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DAY_END, DAY_START, toIsoInstant, toLocalParts } from "@/lib/date-range";
import { usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { useUserMap } from "@/features/deals/hooks";
import { personName } from "@/features/deals/person-name";
import { useJobSources } from "@/features/job-sources/hooks";
import { useJobTags } from "@/features/job-tags/hooks";
import { activeJobTags } from "@/features/job-tags/lib";
import { useServiceAreas } from "@/features/service-areas/hooks";
import { DailyChart } from "@/features/dashboard/components/daily-chart";
import { compactMoney } from "@/features/dashboard/lib";
import { datePresetRange, type DatePreset } from "../lib";
import { useJobStatistics } from "../job-statistics/hooks";
import {
  breakdownCsv,
  breakdownRows,
  breakdownTotals,
  groupSeries,
  sortRows,
  type BreakdownColumn,
  type BreakdownRow,
  type BreakdownTotals,
  type Grain,
} from "../job-statistics/lib";

const ALL = "__all__";

const money2 = (n?: number): string =>
  `$${(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const grainLabel = (grain: Grain) => (date: string): string => {
  const d = new Date(`${date}T00:00:00Z`);
  return grain === "month"
    ? d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

type Area = "metro" | "city" | "zip";

/**
 * Workiz's Job Statistics: a period's jobs by the date they were created,
 * scheduled or closed (Closed by default), overall and per source, tech,
 * area and dispatcher (the job's creator). Sales and profit are the Done
 * jobs' and show only with `financials.view` — the server leaves them out
 * otherwise. Workiz's pies are left out: the table ranks the same numbers.
 */
export function JobStatisticsPage({ today }: { today: string }) {
  const { can } = usePermissions();
  const money = can("financials");

  const [by, setBy] = useState<DealStatsBy>("closed");
  const [preset, setPreset] = useState<DatePreset>("this_month");
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({});
  const [serviceArea, setServiceArea] = useState(ALL);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const range = preset === "custom" ? custom : datePresetRange(preset, today);
  const from = range.from ?? today;
  const to = range.to ?? from;

  const stats = useJobStatistics({
    by,
    from,
    to,
    ...(serviceArea !== ALL && { serviceArea }),
    ...(tagIds.length && { tagIds }),
  });
  const areas = (useServiceAreas().data ?? []).filter((a) => a.active).map((a) => a.name).sort();
  const tags = activeJobTags(useJobTags().data);

  if (!can("reports", "view") || !can("deals")) return <NoAccess entity="reports" />;

  const toggleTag = (id: string) =>
    setTagIds((cur) => (cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]));

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" aria-label="Back to reports">
            <Link href="/reports">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <h1 className="text-lg font-semibold tracking-tight">Job Statistics</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="By time"
            className="h-9 rounded-md border bg-transparent px-2 text-sm"
            value={by}
            onChange={(e) => setBy(e.target.value as DealStatsBy)}
          >
            <option value="created">By: Created</option>
            <option value="scheduled">By: Scheduled</option>
            <option value="closed">By: Closed</option>
          </select>
          <select
            aria-label="Date preset"
            className="h-9 rounded-md border bg-transparent px-2 text-sm"
            value={preset}
            onChange={(e) => setPreset(e.target.value as DatePreset)}
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="this_week">This week (Mon–Today)</option>
            <option value="last_week">Last week</option>
            <option value="this_month">This month</option>
            <option value="last_month">Last month</option>
            <option value="custom">Custom</option>
          </select>
          <DateTimeRangePicker
            dateOnly
            label="Days"
            value={{ from: toIsoInstant(from, DAY_START), to: toIsoInstant(to, DAY_END) }}
            onChange={(r) => {
              setPreset("custom");
              setCustom({ from: toLocalParts(r.from)?.date, to: toLocalParts(r.to)?.date });
            }}
          />
          <select
            aria-label="Service area"
            className="h-9 rounded-md border bg-transparent px-2 text-sm"
            value={serviceArea}
            onChange={(e) => setServiceArea(e.target.value)}
          >
            <option value={ALL}>All Service Areas</option>
            {areas.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b px-6 py-2" aria-label="Tags">
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
        <Report stats={stats.data} money={money} />
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

function Report({ stats, money }: { stats: DealStats; money: boolean }) {
  const [grain, setGrain] = useState<Grain>("day");
  const [area, setArea] = useState<Area>("metro");
  const people = useUserMap([...stats.byTech, ...stats.byCreator].map((b) => b.key));
  const sources = useJobSources();

  const personNames = useMemo(() => {
    const out: Record<string, string | undefined> = {};
    for (const [id, u] of people.map) out[id] = personName(u);
    return out;
  }, [people.map]);
  const sourceNames = useMemo(
    () => Object.fromEntries((sources.data ?? []).map((s) => [s.id, s.name])),
    [sources.data],
  );

  const series = groupSeries(stats.series, grain);
  const s = stats.jobs.byStatus;
  const areaBuckets = area === "zip" ? stats.byZip : area === "city" ? stats.byCity : stats.byServiceArea;

  return (
    <Tabs defaultValue="overview" className="p-6">
      <TabsList>
        <TabsTrigger value="overview">Jobs overview</TabsTrigger>
        <TabsTrigger value="sources">Sources</TabsTrigger>
        <TabsTrigger value="tech">Tech Performance</TabsTrigger>
        <TabsTrigger value="area">Area Performance</TabsTrigger>
        <TabsTrigger value="dispatch">Dispatcher Performance</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="flex flex-col gap-4 pt-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi label="Jobs Done" value={s.done} />
          <Kpi label="Jobs Submitted" value={s.submitted} />
          <Kpi label="Jobs In Progress" value={s.in_progress} />
          <Kpi label="Jobs Canceled" value={s.canceled} />
          {money && stats.money && (
            <>
              <Kpi label="Total Sales" value={compactMoney(stats.money.revenue)} />
              <Kpi label="Total Profit" value={compactMoney(stats.money.profit)} />
            </>
          )}
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
              series={["Jobs", "Canceled"]}
              days={series.map((d) => ({ date: d.date, value: d.jobs, compare: d.canceled }))}
              format={(v) => v.toLocaleString("en-US")}
              labelOf={grainLabel(grain)}
            />
          </Card>
          {money && (
            <Card className="px-4">
              <h2 className="text-base font-semibold">Sales</h2>
              <DailyChart
                title="Sales and profit"
                series={["Sales", "Profit"]}
                days={series.map((d) => ({ date: d.date, value: d.revenue ?? 0, compare: d.profit ?? 0 }))}
                format={compactMoney}
                labelOf={grainLabel(grain)}
              />
            </Card>
          )}
        </div>
      </TabsContent>

      <TabsContent value="sources" className="pt-4">
        <Breakdown title="Sources" group="Job Source" buckets={stats.bySource} names={sourceNames} />
      </TabsContent>
      <TabsContent value="tech" className="pt-4">
        <Breakdown title="Tech Performance" group="Tech" buckets={stats.byTech} names={personNames} />
      </TabsContent>
      <TabsContent value="area" className="flex flex-col gap-3 pt-4">
        <div role="radiogroup" aria-label="Drill by" className="flex gap-3 text-sm">
          {(["metro", "city", "zip"] as Area[]).map((a) => (
            <label key={a} className="flex items-center gap-1.5">
              <input type="radio" name="drill-by" checked={area === a} onChange={() => setArea(a)} />
              {a === "metro" ? "Metro" : a === "city" ? "City" : "Zip"}
            </label>
          ))}
        </div>
        <Breakdown
          title="Area Performance"
          group={area === "metro" ? "Service Area" : area === "city" ? "City" : "Zip"}
          buckets={areaBuckets}
          names={{}}
        />
      </TabsContent>
      <TabsContent value="dispatch" className="pt-4">
        <Breakdown title="Dispatcher Performance" group="Dispatcher" buckets={stats.byCreator} names={personNames} />
      </TabsContent>
    </Tabs>
  );
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <Card size="sm" className="px-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-2xl font-semibold">{typeof value === "number" ? value.toLocaleString("en-US") : value}</span>
      </div>
    </Card>
  );
}

const COLUMNS: { key: Exclude<BreakdownColumn, "name">; label: string; money?: boolean; format?: "pct" | "money" }[] = [
  { key: "all", label: "All Jobs" },
  { key: "done", label: "Done Jobs" },
  { key: "open", label: "Open Jobs" },
  { key: "canceled", label: "Canceled Jobs" },
  { key: "canceledPct", label: "Canceled %", format: "pct" },
  { key: "gross", label: "Gross Amount", money: true, format: "money" },
  { key: "profit", label: "Profit", money: true, format: "money" },
  { key: "avgSale", label: "Average Sale", money: true, format: "money" },
  { key: "avgProfit", label: "Average Profit", money: true, format: "money" },
];

function show(value: number | undefined, format?: "pct" | "money"): string {
  if (format === "money") return money2(value);
  if (format === "pct") return `${value ?? 0}%`;
  return (value ?? 0).toLocaleString("en-US");
}

/** One Workiz breakdown table: sortable by any column, a Totals row, CSV export. */
function Breakdown({
  title,
  group,
  buckets,
  names,
}: {
  title: string;
  group: string;
  buckets: DealStatsBucket[];
  names: Record<string, string | undefined>;
}) {
  const [sort, setSort] = useState<{ by: BreakdownColumn; dir: "asc" | "desc" }>({ by: "all", dir: "desc" });
  const rows = breakdownRows(buckets, names);
  const totals: BreakdownTotals = breakdownTotals(rows);
  const money = totals.gross !== undefined;
  const columns = COLUMNS.filter((c) => money || !c.money);
  const sorted: BreakdownRow[] = sortRows(rows, sort.by, sort.dir);

  const toggle = (by: BreakdownColumn) =>
    setSort((cur) => ({ by, dir: cur.by === by && cur.dir === "desc" ? "asc" : "desc" }));

  const exportCsv = () => {
    const blob = new Blob([breakdownCsv(group, sorted, totals)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `job-statistics-${title.toLowerCase().replace(/\W+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (rows.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">No data found</p>;

  const header = (key: BreakdownColumn, label: string, alignRight = true) => (
    <th scope="col" className={`px-3 py-2 font-medium ${alignRight ? "text-right" : "text-left"}`} aria-sort={sort.by === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="hover:underline" onClick={() => toggle(key)}>
        {label}
      </button>
    </th>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="size-4" /> Export List
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table aria-label={title} className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              {header("name", group, false)}
              {columns.map((c) => header(c.key, c.label))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.key} className="border-t">
                <td className="px-3 py-2">{r.name}</td>
                {columns.map((c) => (
                  <td key={c.key} className="px-3 py-2 text-right tabular-nums">
                    {show(r[c.key], c.format)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted font-medium">
              <td className="px-3 py-2">Totals</td>
              {columns.map((c) => (
                <td key={c.key} className="px-3 py-2 text-right tabular-nums">
                  {show(totals[c.key], c.format)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
