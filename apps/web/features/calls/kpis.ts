/**
 * The stat cards over the call log — Workiz's MISSED CALLS, CALLS (N callers),
 * CONVERSION RATE and REVENUE (callspage_wz_01_today). Workiz's fifth card,
 * DISPATCHER SCORE, is an AI grade we have no source for, so it is not drawn.
 */

/**
 * `GET /telephony/calls/stats/summary` — the aggregates of the calls the
 * log's filters select, as Workiz returns them beside its rows (`aggs`).
 * Proposed for the telephony service; until it ships the request fails and
 * only CALLS is drawn, from the log's own count.
 */
export interface CallsSummary {
  /** Calls the filters select — the table's total. */
  calls: number;
  /** Distinct outside numbers among them. */
  callers: number;
  /** Inbound calls nobody picked up (call tracking's rule). */
  missed: number;
  /** Calls still going. */
  active?: number;
  /** Distinct jobs the calls are linked to. */
  jobs: number;
  /** Σ the linked jobs' totals; absent without `financials.view`. */
  revenue?: number;
  /** The walk stopped on its read budget: every number is a floor. */
  atLeast?: boolean;
}

export interface KpiCard {
  id: "missed" | "calls" | "conversion" | "revenue";
  label: string;
  value: string;
  /** The grey words at the right of the number ("226 callers"). */
  aside?: string;
  /** Workiz's red label and number (missed calls > 0). */
  alert: boolean;
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/**
 * The cards to draw, in Workiz's order. A card without a real number is left
 * out rather than drawn as 0: CALLS falls back to the log's own count when
 * the summary is not served, and Revenue needs `financials.view`.
 */
export function callsKpis({
  count,
  summary,
  showMoney,
}: {
  /** `GET /telephony/calls/count`; `total: null` = no number for this caller. */
  count?: { total: number | null; atLeast?: boolean };
  summary?: CallsSummary;
  showMoney: boolean;
}): KpiCard[] {
  const cards: KpiCard[] = [];
  const floor = (n: number, atLeast?: boolean) => `${n}${atLeast ? "+" : ""}`;
  if (summary) {
    cards.push({ id: "missed", label: "MISSED CALLS", value: floor(summary.missed, summary.atLeast), alert: summary.missed > 0 });
  }
  if (summary) {
    cards.push({
      id: "calls",
      label: "CALLS",
      value: floor(summary.calls, summary.atLeast),
      aside: `${summary.callers} callers`,
      alert: false,
    });
  } else if (count && typeof count.total === "number") {
    cards.push({ id: "calls", label: "CALLS", value: floor(count.total, count.atLeast), alert: false });
  }
  if (summary) {
    const rate = summary.callers > 0 ? (summary.jobs / summary.callers) * 100 : 0;
    cards.push({ id: "conversion", label: "CONVERSION RATE", value: `${rate.toFixed(1)}%`, alert: false });
  }
  if (summary && showMoney && typeof summary.revenue === "number") {
    cards.push({ id: "revenue", label: "REVENUE", value: money.format(summary.revenue), alert: false });
  }
  return cards;
}
