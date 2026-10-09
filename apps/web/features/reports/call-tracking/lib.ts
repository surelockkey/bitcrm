import type { CallTrackingCards, CallTrackingGraph, CallTrackingGroupBy, CallTrackingRow } from "@bitcrm/types";

/*
 * Call Tracking, web side: the query, the cards and cells as Workiz prints
 * them, the graph's buckets and colours, the table's columns and its
 * client-side sort and paging (Workiz pages the rows it already has, 20 at a
 * time, and sorts them in the browser). Measured off rep_calltracking_wz_*
 * (workiz-data-parser docs/import/app-parity-2026-10-08/rep_calltracking.md).
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

/**
 * The Avg Duration card: "1 Min 34 Sec". Workiz rounds the rows' mean to the
 * second — 290.5 s reads "4 Min 51 Sec" (rep_calltracking_wz_11_preset_today).
 */
export function cardDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return m ? `${m} Min ${s % 60} Sec` : `${s} Sec`;
}

/** A row's average: "2 min 26 sec", "20 sec"; a row nobody answered reads "0sec". */
export function rowDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s === 0) return "0sec";
  const m = Math.floor(s / 60);
  return m ? `${m} min ${s % 60} sec` : `${s} sec`;
}

/** "$3243.84" — react-table prints the amount bare, no thousands separators. */
export const usd = (n?: number): string => `$${(n ?? 0).toFixed(2)}`;

/** A row's rate as the API gives it: "18.99%", "79.5%", "0%". */
export const pct = (n: number): string => `${Number(n.toFixed(2))}%`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The x axis as Workiz writes it: "1:00 PM", "10/01/26", "week 2  In Oct"
 * (its week of the month, two spaces and all), "10/26".
 */
export function bucketLabel(graphBy: CallTrackingParams["graphBy"], bucket: string): string {
  if (graphBy === "hour") {
    const h = Number(bucket);
    return `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`;
  }
  const [y, m, d] = bucket.split("-");
  if (graphBy === "month") return `${m}/${y.slice(2)}`;
  if (graphBy === "week") return `week ${Math.floor((Number(d) - 1) / 7) + 1}  In ${MONTHS[Number(m) - 1]}`;
  return `${m}/${d}/${y.slice(2)}`;
}

/** One card: the figure over its caption. */
export interface TrackingCardFigure {
  caption: string;
  value: string;
}

/**
 * Workiz's seven cards, in its order. Counts print raw ("2652"), Conversion
 * with two decimals ("26.13%", "0.00%") — "0%" when the period has no row at
 * all —, Revenue bare ("$78160.39") and only with `financials.view`.
 */
export function trackingCardFigures(
  cards: CallTrackingCards,
  { hasRows, money }: { hasRows: boolean; money: boolean },
): TrackingCardFigure[] {
  const out: TrackingCardFigure[] = [
    { caption: "Incoming calls", value: String(cards.incomingCalls) },
    { caption: "Callers", value: String(cards.callers) },
    { caption: "Missed calls", value: String(cards.missedCalls) },
    { caption: "Top Flow", value: cards.topFlow ?? "N/A" },
    { caption: "Avg Duration", value: cardDuration(cards.avgDurationSeconds) },
    { caption: "Conversion", value: hasRows ? `${cards.conversion.toFixed(2)}%` : "0%" },
  ];
  if (money) out.push({ caption: "Revenue", value: usd(cards.revenue) });
  return out;
}

/** What the graph draws: the labels of the buckets that had calls, and a line per flow. */
export interface TrackingGraphView {
  labels: string[];
  series: { label: string; values: number[] }[];
}

/**
 * The graph as Workiz draws it: only the buckets some flow had a call in
 * (Workiz's points are its call rows; an hour nobody called is not on the
 * axis), in time order, and the flows sorted by name — its datasets' order,
 * a leading space first. (Workiz's own hour axis runs in the order the hours
 * first appear in its rows, "12:00 AM, 7:00 AM … 6:00 AM"; ours runs by the
 * clock.)
 */
export function graphView(graph: CallTrackingGraph): TrackingGraphView {
  const keep = graph.buckets
    .map((_, i) => i)
    .filter((i) => graph.series.some((s) => (s.counts[i] ?? 0) > 0));
  const series = [...graph.series]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((s) => ({ label: s.name, values: keep.map((i) => s.counts[i] ?? 0) }));
  return { labels: keep.map((i) => bucketLabel(graph.graphBy, graph.buckets[i])), series };
}

/** Workiz's fixed palette (the dashboard's `wzSeries1..8`), first eight lines. */
const PALETTE = Array.from({ length: 8 }, (_, i) => `var(--wz-series${i + 1})`);

/**
 * A line's colour. Workiz gives eight of its lines its palette and the rest
 * random rgb on every load; we keep the palette for the first eight (by name)
 * and derive the rest from the flow's name, so a flow keeps its colour.
 */
export function seriesColor(index: number, name: string): string {
  if (index < PALETTE.length) return PALETTE[index];
  // FNV-1a over the name, three bytes of it.
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `rgb(${h & 255} ${(h >>> 8) & 255} ${(h >>> 16) & 255})`;
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

export interface CallTrackingColumnDef {
  key: CallTrackingColumn;
  label: string;
  /** react-table `width: 150` (flex 150 against everyone else's 100): the two rates. */
  wide: boolean;
}

/** Workiz's twelve columns, in its order. The first reads "Flow" or "Number". */
export function callTrackingColumns(groupBy: CallTrackingGroupBy, money: boolean): CallTrackingColumnDef[] {
  const all: CallTrackingColumnDef[] = [
    { key: "name", label: groupBy === "numbers" ? "Number" : "Flow", wide: false },
    { key: "adGroup", label: "Ad group", wide: false },
    { key: "calls", label: "Calls", wide: false },
    { key: "callers", label: "Callers", wide: false },
    { key: "completed", label: "Completed", wide: false },
    { key: "missed", label: "Missed", wide: false },
    { key: "avgDurationSeconds", label: "Avg duration", wide: false },
    { key: "jobs", label: "Jobs", wide: false },
    { key: "leads", label: "Leads", wide: false },
    { key: "jobsConversionRate", label: "Job conversion rate", wide: true },
    { key: "revenue", label: "Revenue", wide: false },
    { key: "leadsConversionRate", label: "Lead conversion rate", wide: true },
  ];
  return money ? all : all.filter((c) => c.key !== "revenue");
}

/**
 * Client-side sort, react-table's `defaultSortMethod`: text lower-cased and
 * compared by code point, numbers by value; ties keep the server's order
 * (busiest first). `null` keeps the server's order.
 */
export function sortTrackingRows(
  rows: CallTrackingRow[],
  sort: { by: CallTrackingColumn; dir: "asc" | "desc" } | null,
  adGroupName: (id?: string) => string,
): CallTrackingRow[] {
  if (!sort) return rows;
  const value = (r: CallTrackingRow): string | number => {
    if (sort.by === "name") return r.name.toLowerCase();
    if (sort.by === "adGroup") return adGroupName(r.adGroupId).toLowerCase();
    return (r[sort.by] as number | undefined) ?? 0;
  };
  const dir = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, v: value(r) }))
    .sort((a, b) => {
      const c = a.v > b.v ? 1 : a.v < b.v ? -1 : 0;
      return c ? c * dir : a.i - b.i;
    })
    .map(({ r }) => r);
}
