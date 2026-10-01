import type {
  DashboardShare,
  JobStatisticsBy,
  JobStatisticsDay,
  JobStatisticsRow,
  JobStatisticsTab,
  JobStatisticsTable,
  JobStatisticsTotals,
} from "@bitcrm/types";
import type { JobsReportPreset } from "../jobs/lib";

/*
 * Workiz's Job Statistics, web side: the toolbar, the request it makes of
 * `GET /deals/report/statistics`, and what the page does with the answer —
 * weeks and months of the day series, the Sources type switch, the tables'
 * names, columns, order, pies and CSV. Every figure comes from the server.
 */

/* ---------------------------------------------------------------- toolbar */

/** Workiz's Job Statistics presets, in its order ("This year" / "Last year" are the Jobs report's only). */
export const STATISTICS_PRESETS: { id: JobsReportPreset; label: string }[] = [
  { id: "custom", label: "Custom" },
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "this_week_sun", label: "This week (Sun-Today)" },
  { id: "this_week_mon", label: "This week (Mon-Today)" },
  { id: "last_7", label: "Last 7 days" },
  { id: "last_week_sun", label: "Last week (Sun-Sat)" },
  { id: "last_week_mon", label: "Last week (Mon-Sun)" },
  { id: "last_business_week", label: "Last business week (Mon-Fri)" },
  { id: "last_14", label: "Last 14 days" },
  { id: "this_month", label: "This month" },
  { id: "last_30", label: "Last 30 days" },
  { id: "last_month", label: "Last month" },
];

/** Workiz opens Job Statistics on this month, by Closed. */
export const DEFAULT_STATISTICS_PRESET: JobsReportPreset = "this_month";
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

function startOf(day: string, grain: Grain): string {
  if (grain === "month") return `${day.slice(0, 7)}-01`;
  if (grain === "week") {
    const dow = new Date(`${day}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday
    return shift(day, dow === 0 ? -6 : 1 - dow);
  }
  return day;
}

const cents = (n: number | undefined): number => Math.round((n ?? 0) * 100);

/** Days summed into Monday-started weeks or calendar months, keyed by their first day — in cents, so nothing drifts. */
export function groupSeries(days: JobStatisticsDay[], grain: Grain): JobStatisticsDay[] {
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
      if (row.kind === "external") return "Unknown company";
      return row.key.startsWith("ad-id:") ? "Unknown source" : "No source";
    case "tech":
      return row.techIds?.length ? "Unknown user" : "Unassigned";
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

const PIE_SLICES = 4;

/**
 * A pie's slices: the three biggest rows and "Other" for the rest, so the
 * percents are of the whole (Workiz draws every row; four read). `measure`
 * is Done Jobs, or Gross for "By Sales Amount" — Workiz draws Profit under
 * that title; this draws what the title says.
 */
export function pieOf(
  rows: JobStatisticsRow[],
  measure: "done" | "gross",
  nameOf: (r: JobStatisticsRow) => string,
): DashboardShare[] {
  const value = (r: JobStatisticsRow) => (measure === "done" ? r.done : (r.gross ?? 0));
  const ranked = rows.filter((r) => value(r) > 0).sort((a, b) => value(b) - value(a));
  const total = ranked.reduce((n, r) => n + value(r), 0);
  if (!total) return [];
  const head = ranked.length > PIE_SLICES ? ranked.slice(0, PIE_SLICES - 1) : ranked;
  const rest = ranked.slice(head.length);
  const slices = head.map((r) => ({ key: r.key, name: nameOf(r), count: value(r) }));
  if (rest.length) slices.push({ key: "__other__", name: "Other", count: rest.reduce((n, r) => n + value(r), 0) });
  return slices.map((s) => ({ ...s, count: round2(s.count), percent: round2((s.count / total) * 100) }));
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
