import type {
  JobStatisticsBy,
  JobStatisticsDay,
  JobStatisticsRow,
  JobStatisticsTab,
  JobStatisticsTable,
  JobStatisticsTotals,
} from "@bitcrm/types";
import { LEGACY_REPORT_PRESETS, type LegacyReportPreset } from "../legacy-presets";

/*
 * Workiz's Job Statistics, web side: the toolbar, the request it makes of
 * `GET /deals/report/statistics`, and what the page does with the answer —
 * weeks and months of the day series, the Sources type switch, the tables'
 * names, columns, order, pies and CSV. Every figure comes from the server.
 */

/* ---------------------------------------------------------------- toolbar */

/**
 * Workiz's Job Statistics presets — the legacy page's list (`legacy-presets.ts`):
 * its order, its spelling, and "Last N days" ending yesterday.
 */
export const STATISTICS_PRESETS = LEGACY_REPORT_PRESETS;

/** Workiz opens Job Statistics on this month, by Closed. */
export const DEFAULT_STATISTICS_PRESET: LegacyReportPreset = "this_month";
export const DEFAULT_STATISTICS_BY: JobStatisticsBy = "end";

export interface StatisticsQuery {
  by: JobStatisticsBy;
  from: string;
  to: string;
  serviceAreaId?: string;
  tagIds?: string[];
}

/** The request: the period on its "By Time" date, plus the filters that are set. Tags are any-of. */
export function statisticsParams(q: StatisticsQuery): string {
  const p = new URLSearchParams({ by: q.by, from: q.from, to: q.to });
  if (q.serviceAreaId) p.set("serviceAreaId", q.serviceAreaId);
  if (q.tagIds?.length) p.set("tagId", q.tagIds.join(","));
  return p.toString();
}

/* ----------------------------------------------------------------- series */

export type Grain = "day" | "week" | "month";

const shift = (day: string, days: number): string => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * A day's bucket. Workiz's weeks are MySQL's: Sunday to Saturday (checked
 * live — 01–03.10.26 in one week, 04–08.10.26 in the next).
 */
function startOf(day: string, grain: Grain): string {
  if (grain === "month") return `${day.slice(0, 7)}-01`;
  if (grain === "week") return shift(day, -new Date(`${day}T00:00:00.000Z`).getUTCDay()); // 0 = Sunday
  return day;
}

/**
 * A bar's name under the chart, as Workiz prints it: the day "10/01/2026",
 * a week by its Wednesday ("09/30/2026" for 27.09–03.10), a month "10/26".
 */
export function seriesLabel(key: string, grain: Grain): string {
  const day = grain === "week" ? shift(key, 3) : key;
  const [y, m, d] = day.split("-");
  return grain === "month" ? `${m}/${y.slice(2)}` : `${m}/${d}/${y}`;
}

const cents = (n: number | undefined): number => Math.round((n ?? 0) * 100);

/* ---------------------------------------------------------------- numbers */

const grouped = (n: number, decimals: number): string =>
  n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/**
 * A table figure as Workiz prints it: thousands grouped, two decimals unless
 * the value is whole ("1,745", "325", "46.70", "724,691.30").
 */
export function wzNumber(n: number | undefined): string {
  const c = cents(n);
  return grouped(c / 100, c % 100 === 0 ? 0 : 2);
}

/** A percent the same way: "100%", "44.90%". */
export const wzPercent = (n: number | undefined): string => `${wzNumber(n)}%`;

/** The KPI money: always the cents, no currency sign ("133,524.60"); nothing at all is "0". */
export const wzMoney = (n: number | undefined): string => (cents(n) === 0 ? "0" : grouped(cents(n) / 100, 2));

/**
 * A table cell by its column's format. `bareCounts`: Workiz's Totals row on
 * Sources, Tech and Dispatcher prints All, Done and Open as the raw numbers
 * its server sends ("3935"), the rest grouped.
 */
export function cellText(
  value: string | number | undefined,
  format: StatisticsColumn["format"],
  opts: { bareCounts?: boolean } = {},
): string {
  if (format === "text") return String(value ?? "");
  const n = Number(value) || 0;
  if (format === "pct") return wzPercent(n);
  if (format === "count" && opts.bareCounts) return String(Math.round(n));
  return wzNumber(n);
}

/**
 * The chart's bars: days, or days summed into Sunday-started weeks or
 * calendar months keyed by their first day — in cents, so nothing drifts.
 * A day without a job is left out, as Workiz leaves it out.
 */
export function groupSeries(all: JobStatisticsDay[], grain: Grain): JobStatisticsDay[] {
  // Workiz's series is a GROUP BY of the period's jobs: no job, no bar.
  const days = all.filter((d) => d.jobs > 0);
  if (grain === "day") return days;
  const out = new Map<string, { row: JobStatisticsDay; sales?: number; profit?: number }>();
  for (const d of days) {
    const key = startOf(d.date, grain);
    const acc = out.get(key) ?? { row: { date: key, jobs: 0, canceled: 0, done: 0 } };
    acc.row.jobs += d.jobs;
    acc.row.canceled += d.canceled;
    acc.row.done += d.done;
    if (d.sales !== undefined) acc.sales = (acc.sales ?? 0) + cents(d.sales);
    if (d.profit !== undefined) acc.profit = (acc.profit ?? 0) + cents(d.profit);
    out.set(key, acc);
  }
  return [...out.values()].map(({ row, sales, profit }) => ({
    ...row,
    ...(sales !== undefined && { sales: sales / 100 }),
    ...(profit !== undefined && { profit: profit / 100 }),
  }));
}

/* ---------------------------------------------------------------- tables */

/** Workiz's "Source type": All sources, Only Ad sources, Only referrals (external companies). */
export type SourceType = "all" | "ad" | "external";

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A Totals row over some rows: the sums, and the ratios recomputed over them (Canceled % over All). */
export function totalsOf(rows: JobStatisticsRow[]): JobStatisticsTotals {
  const all = rows.reduce((n, r) => n + r.all, 0);
  const done = rows.reduce((n, r) => n + r.done, 0);
  const canceled = rows.reduce((n, r) => n + r.canceled, 0);
  const has = (k: keyof JobStatisticsTotals) => rows.length > 0 && rows.every((r) => r[k] !== undefined);
  const sum = (k: "gross" | "profit" | "laborCost" | "techExpenses") => rows.reduce((c, r) => c + cents(r[k]), 0);
  const per = (c: number) => (done ? Math.round(c / done) / 100 : 0);
  return {
    all,
    done,
    open: all - done - canceled,
    canceled,
    canceledPct: all ? round2((canceled / all) * 100) : 0,
    ...(has("gross") && { gross: sum("gross") / 100, avgSale: per(sum("gross")) }),
    ...(has("profit") && { profit: sum("profit") / 100, avgProfit: per(sum("profit")) }),
    ...(has("laborCost") && { laborCost: sum("laborCost") / 100 }),
    ...(has("techExpenses") && { techExpenses: sum("techExpenses") / 100 }),
  };
}

/** The Sources table under a source type — the server's Totals for all, recomputed otherwise. */
export function sourcesOf(table: JobStatisticsTable, type: SourceType): JobStatisticsTable {
  if (type === "all") return table;
  const rows = table.rows.filter((r) => (type === "external" ? r.kind === "external" : r.kind !== "external"));
  return { rows, totals: totalsOf(rows) };
}

export type AreaDrill = "metro" | "city" | "zip";

/** What a row is called, blanks spelled out. */
export function rowName(tab: JobStatisticsTab, row: JobStatisticsRow, drill: AreaDrill = "metro"): string {
  if (row.label) return row.label;
  switch (tab) {
    case "sources":
      // Workiz's row for jobs without an ad group is "unknown".
      if (row.kind === "external") return "Unknown company";
      return row.key.startsWith("ad-id:") ? "Unknown source" : "unknown";
    case "tech":
      return row.techIds?.length ? "Unknown user" : "unassigned";
    case "area":
      return drill === "zip" ? "No zip" : drill === "city" ? "No city" : "No name";
    case "dispatcher":
      return "Unknown user";
    case "jobTypes":
      return "No job type";
  }
}

export type ColumnKey = keyof JobStatisticsTotals | "name" | "city" | "serviceArea";
export interface StatisticsColumn {
  key: ColumnKey;
  label: string;
  format: "text" | "count" | "pct" | "money";
}

const NAME_LABEL: Record<Exclude<JobStatisticsTab, "area">, string> = {
  sources: "Job Source",
  tech: "Tech",
  dispatcher: "Dispatcher",
  jobTypes: "Job Type",
};

/**
 * A tab's columns, Workiz's order: the name (Area: Zip · City · Service
 * Area, as the drill shows them), the counts, then the money — Labor cost and
 * Tech expenses on Tech only, Profit only when the answer carries it.
 */
export function columnsFor(tab: JobStatisticsTab, drill: AreaDrill, show: { money: boolean; profit: boolean }): StatisticsColumn[] {
  const names: StatisticsColumn[] =
    tab !== "area"
      ? [{ key: "name", label: NAME_LABEL[tab], format: "text" }]
      : drill === "zip"
        ? [
            { key: "name", label: "Zip", format: "text" },
            { key: "city", label: "City", format: "text" },
          ]
        : drill === "city"
          ? [
              { key: "name", label: "City", format: "text" },
              { key: "serviceArea", label: "Service Area", format: "text" },
            ]
          : [{ key: "name", label: "Service Area", format: "text" }];
  const counts: StatisticsColumn[] = [
    { key: "all", label: "All Jobs", format: "count" },
    { key: "done", label: "Done Jobs", format: "count" },
    { key: "open", label: "Open Jobs", format: "count" },
    { key: "canceled", label: "Canceled Jobs", format: "count" },
    { key: "canceledPct", label: "Canceled %", format: "pct" },
  ];
  if (!show.money) return [...names, ...counts];
  const money = (key: ColumnKey, label: string): StatisticsColumn => ({ key, label, format: "money" });
  return [
    ...names,
    ...counts,
    money("gross", "Gross Amount"),
    ...(show.profit ? [money("profit", "Profit")] : []),
    ...(tab === "tech" ? [money("laborCost", "Labor cost"), money("techExpenses", "Tech expenses")] : []),
    money("avgSale", "Average Sale"),
    ...(show.profit ? [money("avgProfit", "Average Profit")] : []),
  ];
}

/** A cell's value for sorting and printing. */
export function cellValue(row: JobStatisticsRow, key: ColumnKey, name: string): string | number | undefined {
  if (key === "name") return name;
  if (key === "city") return row.city ?? "";
  if (key === "serviceArea") return row.serviceArea ?? "";
  return row[key];
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

export interface TableSort {
  key: ColumnKey;
  dir: "asc" | "desc";
}

/** DataTables' default: the first column, A to Z. */
export const DEFAULT_SORT: TableSort = { key: "name", dir: "asc" };

/** A header click, DataTables' way: another column (or the first click on an unsorted grid) starts ascending, the same column flips. */
export function nextSort(cur: TableSort | null, key: ColumnKey): TableSort {
  if (!cur || cur.key !== key) return { key, dir: "asc" };
  return { key, dir: cur.dir === "asc" ? "desc" : "asc" };
}

/** Workiz sorts its tables in the browser, on any column. */
export function sortRows(
  rows: JobStatisticsRow[],
  key: ColumnKey,
  dir: "asc" | "desc",
  nameOf: (r: JobStatisticsRow) => string,
): JobStatisticsRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = cellValue(a, key, nameOf(a));
    const vb = cellValue(b, key, nameOf(b));
    const c =
      typeof va === "number" || typeof vb === "number"
        ? (Number(va) || 0) - (Number(vb) || 0)
        : collator.compare(String(va ?? ""), String(vb ?? ""));
    return c * sign || collator.compare(nameOf(a), nameOf(b));
  });
}

/** Rows whose name columns hold the text — Workiz's search box on the Area tab. */
export function searchRows(rows: JobStatisticsRow[], q: string, nameOf: (r: JobStatisticsRow) => string): JobStatisticsRow[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) => [nameOf(r), r.city, r.serviceArea].some((v) => v?.toLowerCase().includes(needle)));
}

/* ------------------------------------------------------------------- pies */

/**
 * Workiz's `colorArray` (statistics_report.source.html): its pies take the
 * n-th colour for the n-th slice; Chart.js v2 paints the slices past the
 * fiftieth its default `rgba(0,0,0,0.1)`.
 */
export const WZ_PIE_COLORS = [
  "#FF6633", "#FFB399", "#FF33FF", "#FFFF99", "#00B3E6", "#E6B333", "#3366E6", "#999966", "#99FF99", "#B34D4D",
  "#80B300", "#809900", "#E6B3B3", "#6680B3", "#66991A", "#FF99E6", "#CCFF1A", "#FF1A66", "#E6331A", "#33FFCC",
  "#66994D", "#B366CC", "#4D8000", "#B33300", "#CC80CC", "#66664D", "#991AFF", "#E666FF", "#4DB3FF", "#1AB399",
  "#E666B3", "#33991A", "#CC9999", "#B3B31A", "#00E680", "#4D8066", "#809980", "#E6FF80", "#1AFF33", "#999933",
  "#FF3380", "#CCCC00", "#66E64D", "#4D80CC", "#9900B3", "#E64D66", "#4DB380", "#FF4D4D", "#99E6E6", "#6666FF",
] as const;
const PIE_FALLBACK = "rgba(0,0,0,0.1)";

export interface PieSlice {
  key: string;
  name: string;
  value: number;
  color: string;
}

/**
 * A pie, Workiz's way (`json.qty` / `json.dollar`): a slice for every row
 * with a Done job, in name order, coloured from Workiz's list. `measure` is
 * Done Jobs, or Gross for "By Sales Amount" — Workiz draws the profit under
 * that title; this draws what the title says (and what a caller without the
 * profit grant may see).
 */
export function pieSlices(
  rows: JobStatisticsRow[],
  measure: "done" | "gross",
  nameOf: (r: JobStatisticsRow) => string,
): PieSlice[] {
  return rows
    .filter((r) => r.done > 0)
    .map((r) => ({ r, name: nameOf(r) }))
    .sort((a, b) => collator.compare(a.name, b.name))
    .map(({ r, name }, i) => ({
      key: r.key,
      name,
      value: round2(measure === "done" ? r.done : (r.gross ?? 0)),
      color: WZ_PIE_COLORS[i] ?? PIE_FALLBACK,
    }));
}

/* -------------------------------------------------------------------- CSV */

const csvCell = (v: string): string => {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

function printed(value: string | number | undefined, format: StatisticsColumn["format"]): string {
  if (format === "money") return (Number(value) || 0).toFixed(2);
  if (format === "pct") return `${value ?? 0}%`;
  return String(value ?? "");
}

/** Workiz's "Export List": the table's columns, every row in its order, and the Totals row last. */
export function tableCsv(
  columns: StatisticsColumn[],
  rows: JobStatisticsRow[],
  totals: JobStatisticsTotals,
  nameOf: (r: JobStatisticsRow) => string,
): string {
  const line = (cells: string[]) => cells.map(csvCell).join(",");
  return [
    line(columns.map((c) => c.label)),
    ...rows.map((r) => line(columns.map((c) => printed(cellValue(r, c.key, nameOf(r)), c.format)))),
    line(
      columns.map((c, i) =>
        c.format === "text" ? (i === 0 ? "Totals:" : "") : printed(totals[c.key as keyof JobStatisticsTotals], c.format),
      ),
    ),
  ].join("\r\n");
}
