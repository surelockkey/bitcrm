import type { CallTrackingGroupBy, CallTrackingRow } from "@bitcrm/types";

/*
 * Call Tracking, web side: the query, the cells as Workiz prints them, the
 * table's columns and its client-side sort and paging (Workiz pages the rows
 * it already has, 20 at a time, and sorts them in the browser).
 */

export const CALL_TRACKING_PAGE_SIZE = 20;

export interface CallTrackingParams {
  from: string;
  to: string;
  groupBy: CallTrackingGroupBy;
  graphBy: "hour" | "day" | "week" | "month";
}

export function callTrackingQuery(p: CallTrackingParams): string {
  return new URLSearchParams({ from: p.from, to: p.to, groupBy: p.groupBy, graphBy: p.graphBy }).toString();
}

/** The Avg Duration card: "1 Min 34 Sec" (whole seconds, rounded down). */
export function cardDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return m ? `${m} Min ${s % 60} Sec` : `${s} Sec`;
}

/** A row's average: "2 min 26 sec", "20 sec". */
export function rowDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return m ? `${m} min ${s % 60} sec` : `${s} sec`;
}

export const usd = (n?: number): string =>
  `$${(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const pct = (n: number): string => `${Number(n.toFixed(2))}%`;

/** The x axis: hour of the day as Workiz writes it, a day, a week's first day, a month. */
export function bucketLabel(graphBy: CallTrackingParams["graphBy"], bucket: string): string {
  if (graphBy === "hour") {
    const h = Number(bucket);
    return `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`;
  }
  if (graphBy === "month") {
    const [y, m] = bucket.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  }
  return new Date(`${bucket}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export type CallTrackingColumn =
  | "name"
  | "adGroup"
  | "calls"
  | "callers"
  | "completed"
  | "missed"
  | "avgDurationSeconds"
  | "jobs"
  | "leads"
  | "jobsConversionRate"
  | "revenue"
  | "leadsConversionRate";

/** Workiz's twelve columns, in its order. The first reads "Flow" or "Number". */
export function callTrackingColumns(
  groupBy: CallTrackingGroupBy,
  money: boolean,
): { key: CallTrackingColumn; label: string; numeric: boolean }[] {
  const all: { key: CallTrackingColumn; label: string; numeric: boolean }[] = [
    { key: "name", label: groupBy === "numbers" ? "Number" : "Flow", numeric: false },
    { key: "adGroup", label: "Ad group", numeric: false },
    { key: "calls", label: "Calls", numeric: true },
    { key: "callers", label: "Callers", numeric: true },
    { key: "completed", label: "Completed", numeric: true },
    { key: "missed", label: "Missed", numeric: true },
    { key: "avgDurationSeconds", label: "Avg duration", numeric: true },
    { key: "jobs", label: "Jobs", numeric: true },
    { key: "leads", label: "Leads", numeric: true },
    { key: "jobsConversionRate", label: "Job conversion rate", numeric: true },
    { key: "revenue", label: "Revenue", numeric: true },
    { key: "leadsConversionRate", label: "Lead conversion rate", numeric: true },
  ];
  return money ? all : all.filter((c) => c.key !== "revenue");
}

/**
 * Client-side sort, as Workiz does it. `null` keeps the server's order
 * (busiest first). Text sorts by name; ties keep the server's order.
 */
export function sortTrackingRows(
  rows: CallTrackingRow[],
  sort: { by: CallTrackingColumn; dir: "asc" | "desc" } | null,
  adGroupName: (id?: string) => string,
): CallTrackingRow[] {
  if (!sort) return rows;
  const value = (r: CallTrackingRow): string | number => {
    if (sort.by === "name") return r.name;
    if (sort.by === "adGroup") return adGroupName(r.adGroupId);
    return (r[sort.by] as number | undefined) ?? 0;
  };
  const dir = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const x = value(a.r);
      const y = value(b.r);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return c ? c * dir : a.i - b.i;
    })
    .map(({ r }) => r);
}
