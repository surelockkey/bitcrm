import { ESTIMATE_STATUS_LABELS, type Estimate, type EstimateStatus } from "@bitcrm/types";
import type { WzDateRange } from "@/components/workiz/date-range-picker";
import { DEFAULT_TZ } from "@/lib/timezone";
import { formatMoney } from "@/features/billing/lib";
import { customRangeError } from "@/features/payments/report";
import { JOBS_REPORT_PRESETS, presetRange, type JobsReportPreset } from "@/features/reports/jobs/lib";
import type { EstimateReportParams } from "@/features/reports/billing/lib";

/*
 * Workiz's Estimates page (`/root/estimates/`, captures uikit_wz_estimates
 * and pg_estimates_wz_*), the rules behind what the list draws: the period
 * box, the status cards, the row's words, the grid's columns and the request.
 */

/* ----------------------------------------------------------------- period */

export type EstimatesListPreset = JobsReportPreset | "all_time";

/**
 * Workiz's period box on this page (pg_estimates_wz_09_period_open): the
 * Jobs report's fifteen, in the same words. Workiz opens on "All time" but
 * never lists it, so a reader who leaves it can only get back by reloading;
 * ours lists it last, so the opening view stays one click away.
 */
export const ESTIMATES_LIST_PRESETS: { id: EstimatesListPreset; label: string }[] = [
  ...JOBS_REPORT_PRESETS.map((p) => ({ id: p.id, label: p.label })),
  { id: "all_time", label: "All time" },
];

/** Workiz opens the page on every estimate ever made. */
export const DEFAULT_ESTIMATES_RANGE: WzDateRange = { preset: "all_time", from: "", to: "" };

/**
 * The days a preset covers, counted from `today` as Workiz's datepicker
 * counts them; "All time" has none ("" … ""), Custom keeps what it has (null).
 */
export function estimatesListRange(preset: string, today: string): { from: string; to: string } | null {
  if (preset === "custom") return null;
  if (preset === "all_time") return { from: "", to: "" };
  return presetRange(preset as Exclude<JobsReportPreset, "custom">, today);
}

/** Workiz's All time box reads "All time" over "All time" (uikit_wz_estimates). */
export function estimatesRangeText(value: WzDateRange): string | undefined {
  return value.preset === "all_time" ? "All time" : undefined;
}

/** Workiz's refusal under From / To (rep_payments_wz_16g_custom_over_year). */
const OVER_A_YEAR = "Date range exceeds 12 months";

/**
 * What the list asks for: no days for All time, the preset's days, or a
 * Custom span — refused (`window: null`) past twelve months, as the billing
 * reports refuse it.
 */
export function estimatesWindow(value: WzDateRange): {
  window: { from?: string; to?: string } | null;
  error: string | null;
} {
  if (value.preset === "all_time") return { window: {}, error: null };
  if (value.preset === "custom") {
    const error = customRangeError(value.from || undefined, value.to || undefined);
    if (error) return { window: null, error: error.includes("12 months") ? OVER_A_YEAR : null };
  }
  return { window: { ...(value.from && { from: value.from }), ...(value.to && { to: value.to }) }, error: null };
}

/**
 * Custom opened straight from All time has no days to keep: it starts on
 * today, as Workiz's From / To start on the days the box was showing.
 */
export function openCustom(next: WzDateRange, today: string): WzDateRange {
  if (next.preset !== "custom" || next.from || next.to) return next;
  return { preset: "custom", from: today, to: today };
}

/* ------------------------------------------------------------------ cards */

/**
 * A status card: the status big, "3371 Worth $4,868,596.54" under it —
 * Workiz prints the count without separators and the money with them.
 */
export function estimateCardText(
  status: EstimateStatus,
  card: { count: number; amount: number } | undefined,
): { value: string; caption: string; label: string } {
  const value = ESTIMATE_STATUS_LABELS[status];
  const caption = `${card?.count ?? 0} Worth ${formatMoney(card?.amount ?? 0)}`;
  return { value, caption, label: `${caption} ${value}` };
}

/* -------------------------------------------------------------------- row */

/** "Job - PK4399"; a client estimate (Workiz's stub, no job) leaves the cell blank. */
export function estimateSourceLabel(e: Pick<Estimate, "dealId" | "dealNumber">): string {
  return e.dealId ? `Job - ${e.dealNumber ?? ""}` : "";
}

/** Workiz dates these three under the status ("Updated: Oct 08, 2026"). */
const UPDATED_ON: Partial<Record<EstimateStatus, "approvedAt" | "declinedAt" | "wonAt">> = {
  approved: "approvedAt",
  declined: "declinedAt",
  won: "wonAt",
};

/** "Oct 08, 2026" on the account's clock, for an approved, declined or won estimate that says when. */
export function estimateUpdatedOn(
  e: Pick<Estimate, "status" | "approvedAt" | "declinedAt" | "wonAt">,
  tz: string = DEFAULT_TZ,
): string | undefined {
  const key = UPDATED_ON[e.status];
  const at = key ? e[key] : undefined;
  const d = at ? new Date(at) : null;
  if (!d || Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "2-digit", year: "numeric" });
}

/* ---------------------------------------------------------------- columns */

export type EstimatesColumnId = "number" | "name" | "client" | "created" | "total" | "status" | "job" | "deposit";

/**
 * Workiz's columns, in its order (uikit_wz_estimates). react-table grows
 * each from 100px (Client from 200) and holds Status at 210; without
 * Workiz's 60px tick column (no bulk actions here) the 1390px frame at
 * 1600px splits as 147 / 294 / 210 — the starting widths, which the reader
 * can drag. A narrower window scrolls the grid sideways.
 */
export const ESTIMATES_LIST_COLUMNS: { id: EstimatesColumnId; label: string; width: number }[] = [
  { id: "number", label: "Estimate", width: 147 },
  { id: "name", label: "Estimate Name", width: 147 },
  { id: "client", label: "Client", width: 294 },
  { id: "created", label: "Created", width: 147 },
  { id: "total", label: "Amount", width: 147 },
  { id: "status", label: "Status", width: 210 },
  { id: "job", label: "Source", width: 147 },
  { id: "deposit", label: "Deposit due", width: 147 },
];

/* ---------------------------------------------------------------- request */

export type CreatedSort = "asc" | "desc";

/** react-table's click on the sorted Created header: it turns round. */
export function nextCreatedSort(dir: CreatedSort): CreatedSort {
  return dir === "desc" ? "asc" : "desc";
}

/**
 * The list's request. Newest first is the server's own order, so `dir` goes
 * only when Created was turned round — a server from before `dir` then still
 * answers the opening view.
 */
export function estimatesListParams({
  window,
  status,
  search,
  dir,
}: {
  window: { from?: string; to?: string };
  status: EstimateStatus | "all";
  search: string;
  dir: CreatedSort;
}): Omit<EstimateReportParams, "cursor" | "limit"> {
  return {
    ...(window.from && { from: window.from }),
    ...(window.to && { to: window.to }),
    ...(status !== "all" && { status }),
    ...(search && { search }),
    ...(dir === "asc" && { dir }),
  };
}
