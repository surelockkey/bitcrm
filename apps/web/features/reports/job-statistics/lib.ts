import type { DealStatsBucket, DealStatsBy, DealStatsDay } from "@bitcrm/types";

/* -------------------------------------------------------------- query */

export interface JobStatisticsFilters {
  by: DealStatsBy;
  from: string;
  to: string;
  /** Service area name, as jobs carry it. */
  serviceArea?: string;
  tagIds?: string[];
}

/** The `GET /deals/stats` query: the window on the "By Time" date, plus the filters that are set. */
export function statsParams(f: JobStatisticsFilters): Record<string, string> {
  const out: Record<string, string> = { [`${f.by}From`]: f.from, [`${f.by}To`]: f.to };
  if (f.serviceArea) out.serviceArea = f.serviceArea;
  if (f.tagIds?.length) out.tagIds = f.tagIds.join(",");
  return out;
}

/* -------------------------------------------------------------- series */

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

const round = (n: number): number => Math.round(n * 100) / 100;

/** Days summed into Monday-started weeks or calendar months, keyed by their first day. */
export function groupSeries(days: DealStatsDay[], grain: Grain): DealStatsDay[] {
  if (grain === "day") return days;
  const out = new Map<string, DealStatsDay>();
  for (const d of days) {
    const key = startOf(d.date, grain);
    const row = out.get(key) ?? { date: key, jobs: 0, canceled: 0 };
    row.jobs += d.jobs;
    row.canceled += d.canceled;
    if (d.revenue !== undefined) row.revenue = round((row.revenue ?? 0) + d.revenue);
    if (d.profit !== undefined) row.profit = round((row.profit ?? 0) + d.profit);
    out.set(key, row);
  }
  return [...out.values()];
}

/* ----------------------------------------------------------- breakdowns */

export interface BreakdownRow {
  key: string;
  name: string;
  all: number;
  done: number;
  open: number;
  canceled: number;
  canceledPct: number;
  gross?: number;
  profit?: number;
  avgSale?: number;
  avgProfit?: number;
}

export type BreakdownTotals = Omit<BreakdownRow, "key" | "name">;

const pct = (part: number, whole: number): number => (whole ? round((part / whole) * 100) : 0);
const per = (amount: number, count: number): number => (count ? round(amount / count) : 0);

function ratios(r: { all: number; done: number; canceled: number; gross?: number; profit?: number }) {
  return {
    canceledPct: pct(r.canceled, r.all),
    ...(r.gross !== undefined && {
      gross: r.gross,
      profit: r.profit ?? 0,
      avgSale: per(r.gross, r.done),
      avgProfit: per(r.profit ?? 0, r.done),
    }),
  };
}

/** One row per group, named; averages are per Done job (Workiz). "" = Not set. */
export function breakdownRows(buckets: DealStatsBucket[], names: Record<string, string | undefined>): BreakdownRow[] {
  return buckets.map((b) => ({
    key: b.key,
    name: b.key ? (names[b.key] ?? b.key) : "Not set",
    all: b.all,
    done: b.done,
    open: b.open,
    canceled: b.canceled,
    ...ratios({ ...b, gross: b.revenue }),
  }));
}

/** The Totals row: sums, with the ratios recomputed over the sums. */
export function breakdownTotals(rows: BreakdownRow[]): BreakdownTotals {
  const money = rows.some((r) => r.gross !== undefined);
  const sum = (k: "all" | "done" | "open" | "canceled" | "gross" | "profit") =>
    round(rows.reduce((s, r) => s + (r[k] ?? 0), 0));
  const t = { all: sum("all"), done: sum("done"), open: sum("open"), canceled: sum("canceled") };
  return { ...t, ...ratios({ ...t, ...(money && { gross: sum("gross"), profit: sum("profit") }) }) };
}

export type BreakdownColumn = keyof Omit<BreakdownRow, "key">;

export function sortRows(rows: BreakdownRow[], by: BreakdownColumn, dir: "asc" | "desc"): BreakdownRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (by === "name") return sign * a.name.localeCompare(b.name);
    return sign * ((a[by] ?? 0) - (b[by] ?? 0));
  });
}

/* -------------------------------------------------------------- export */

const COUNT_HEADERS = ["All Jobs", "Done Jobs", "Open Jobs", "Canceled Jobs", "Canceled %"];
const MONEY_HEADERS = ["Gross Amount", "Profit", "Average Sale", "Average Profit"];

const cell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const amount = (n?: number): string => (n ?? 0).toFixed(2);

/** The breakdown as CSV, Totals last; the money columns only when the rows carry money. */
export function breakdownCsv(groupLabel: string, rows: BreakdownRow[], totals: BreakdownTotals): string {
  const money = totals.gross !== undefined;
  const line = (name: string, r: BreakdownTotals) =>
    [
      cell(name),
      r.all,
      r.done,
      r.open,
      r.canceled,
      r.canceledPct,
      ...(money ? [amount(r.gross), amount(r.profit), amount(r.avgSale), amount(r.avgProfit)] : []),
    ].join(",");
  return [
    [groupLabel, ...COUNT_HEADERS, ...(money ? MONEY_HEADERS : [])].join(","),
    ...rows.map((r) => line(r.name, r)),
    line("Totals", totals),
  ].join("\n");
}
