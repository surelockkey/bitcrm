/**
 * Workiz Reports → Call Tracking (`GET /api/telephony/calls/stats/tracking`).
 *
 * Inbound calls of a period grouped by the call flow that answered them or by
 * the tracked number they came through: calls, distinct callers, answered,
 * missed, average talk time, the jobs the calls led to, conversion and the
 * revenue of those jobs. The arithmetic is Workiz's own, checked against the
 * live report (docs/reports/call-tracking.md, «Перевірено наживо 2026-09-29»):
 *
 * - answered = Workiz `dial_call_status` completed (our own calls: somebody picked up);
 *   missed = nobody picked up (empty dial status, or no-answer); busy, and an
 *   empty dial the flow's voicemail box took (`voicemail` 2), are neither;
 * - avg duration = Σ talk time of all the row's calls ÷ its answered calls;
 * - callers = distinct caller numbers WITHIN a row, so the card (a sum of rows)
 *   is bigger in the number view than in the flow view;
 * - jobs = distinct jobs of the row's calls, whatever their status (canceled too);
 * - the Conversion and Avg Duration cards are plain means of the rows, zero rows
 *   included; Top Flow is the first row (N/A in the number view).
 */

export const CALL_TRACKING_GROUP_BY = ['flows', 'numbers'] as const;
export type CallTrackingGroupBy = (typeof CALL_TRACKING_GROUP_BY)[number];

/** The graph's step. `hour` is the hour of the day over the whole period (peak hours). */
export const CALL_TRACKING_GRAPH_BY = ['hour', 'day', 'week', 'month'] as const;
export type CallTrackingGraphBy = (typeof CALL_TRACKING_GRAPH_BY)[number];

/** The longest window one request may ask for — Workiz's "This year" / "Last year". */
export const CALL_TRACKING_MAX_DAYS = 366;

/** One line of the table — a call flow or a tracked number. */
export interface CallTrackingRow {
  /** The flow id (or `workiz:<id>` / `name:<name>` for a flow gone from the catalog), or the E.164 number. */
  key: string;
  /** The flow's name, or the number as the account formats it: `(203) 403-6303`. */
  name: string;
  /** Number view: the E.164 number. */
  number?: string;
  /** Number view: the flow answering the number (Workiz sends it but shows no column). */
  flowName?: string;
  /** Job source the row is attributed to — Workiz's "Ad group". */
  adGroupId?: string;
  calls: number;
  callers: number;
  completed: number;
  missed: number;
  /** Σ talk time of all the row's calls ÷ its answered calls, rounded down (Workiz's formula). */
  avgDurationSeconds: number;
  jobs: number;
  /** Always 0 here — leads are not a record of their own in this CRM. */
  leads: number;
  /** jobs / callers × 100, two decimals. */
  jobsConversionRate: number;
  leadsConversionRate: number;
  /** Σ total of the row's jobs. Absent without `financials.view`. */
  revenue?: number;
}

/** The seven cards over the graph. */
export interface CallTrackingCards {
  /** Σ calls — inbound only. */
  incomingCalls: number;
  /** Σ callers of the rows (not distinct callers overall — Workiz's sum). */
  callers: number;
  missedCalls: number;
  /** The first row's name; `null` = N/A (number view, or no calls). */
  topFlow: string | null;
  /** Plain mean of the rows' average durations, seconds (may be fractional). */
  avgDurationSeconds: number;
  /** Plain mean of the rows' conversion rates, percent. */
  conversion: number;
  /** Absent without `financials.view`. */
  revenue?: number;
}

export interface CallTrackingSeries {
  name: string;
  /** One count per bucket, zeros included. */
  counts: number[];
}

/**
 * Calls per flow over the period — always by flow, whichever grouping the
 * table uses (as in Workiz). The hundred busiest flows get a line each, busiest
 * first; the quieter ones are not drawn (Workiz's graph had 100 of 103 flows,
 * rep_calltracking 2026-10-09).
 */
export interface CallTrackingGraph {
  graphBy: CallTrackingGraphBy;
  /**
   * `00`..`23` (hour of day), `YYYY-MM-DD` (a day; for `week` the first day of
   * Workiz's week of the month — the 1st, 8th, 15th, 22nd or 29th), or `YYYY-MM`.
   */
  buckets: string[];
  series: CallTrackingSeries[];
}

export interface CallTrackingReport {
  /** Account days (America/New_York), inclusive. */
  from: string;
  to: string;
  groupBy: CallTrackingGroupBy;
  graphBy: CallTrackingGraphBy;
  /** Busiest first — the order Workiz sends and the table opens with. */
  rows: CallTrackingRow[];
  cards: CallTrackingCards;
  graph: CallTrackingGraph;
  /** The walk of the call log stopped on its read budget: the numbers are a floor. */
  atLeast: boolean;
  /** When the numbers were computed — the report is served from a snapshot. */
  computedAt: string;
}

/** Lines the graph draws, busiest flows first — Workiz's limit; the rest are left out. */
export const CALL_TRACKING_GRAPH_SERIES = 100;

/**
 * Workiz's graph week, by the day of the month — "week 1  In Oct" is the
 * 1st–7th, "week 2" the 8th–14th … "week 5" the 29th to the month's end,
 * whatever weekday the month starts on (rep_calltracking_wz_04_graph_week:
 * every flow's Oct 1–7 / Oct 8–9 counts). Named by its first day.
 */
export function callTrackingWeekStart(day: string): string {
  const first = Math.floor((Number(day.slice(8, 10)) - 1) / 7) * 7 + 1;
  return `${day.slice(0, 8)}${String(first).padStart(2, '0')}`;
}
