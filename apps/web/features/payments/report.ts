import {
  PAYMENT_REPORT_TYPE_FILTERS,
  type PaymentReportQuery,
} from "@bitcrm/types";
import type { WzDateRange } from "@/components/workiz/date-range-picker";
import { formatWzDayRange } from "@/components/workiz/dates";
import type { WzFilterGroup } from "@/components/workiz/grouped-filter";
import { DEFAULT_TZ } from "@/lib/timezone";
import { JOBS_REPORT_PRESETS, presetRange, type JobsReportPreset } from "@/features/reports/jobs/lib";
import { filterAreas } from "@/features/deals/job-filters";

/*
 * The Payments report's toolbar logic (Workiz Reports → Payments,
 * `/root/payments`): the date box, the "Filter results" groups, the query
 * they turn into and the way its cells print.
 *
 * The first block below (PAYMENT_DATE_PRESETS … paymentPresetRange) is the
 * older list the billing report pages (Invoices, Estimates, Tax, Aging) still
 * share; the Payments report itself uses PAYMENTS_REPORT_PRESETS, checked
 * live against Workiz's datepicker on 2026-10-09.
 */

/** Workiz's presets, in Workiz's order. "Last N months" are FULL months; this one is not included. */
export const PAYMENT_DATE_PRESETS = [
  { value: "custom", label: "Custom" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_14_days", label: "Last 14 days" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "last_month", label: "Last month" },
  { value: "this_month", label: "This month" },
  { value: "this_year", label: "This year" },
  { value: "last_year", label: "Last year" },
  { value: "this_week_sun", label: "This week (Sun - Today)" },
  { value: "this_week_mon", label: "This week (Mon - Today)" },
  { value: "last_week_sun", label: "Last week (Sun - Sat)" },
  { value: "last_week_mon", label: "Last week (Mon - Sun)" },
  { value: "last_business_week", label: "Last business week" },
  { value: "last_3_months", label: "Last 3 months" },
  { value: "last_6_months", label: "Last six months" },
  { value: "last_12_months", label: "Last twelve months" },
  { value: "all_time", label: "All time" },
  { value: "recent", label: "Recent (30 days)" },
] as const;

export type PaymentDatePreset = (typeof PAYMENT_DATE_PRESETS)[number]["value"];

/** Workiz refuses a Custom range longer than this. */
export const MAX_CUSTOM_DAYS = 366;

/** Today on the business clock, YYYY-MM-DD. */
export function businessToday(now: Date = new Date(), tz: string = DEFAULT_TZ): string {
  return now.toLocaleDateString("en-CA", { timeZone: tz });
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const dow = (day: string): number => new Date(`${day}T00:00:00.000Z`).getUTCDay();
const firstOfMonth = (day: string) => `${day.slice(0, 7)}-01`;

/** The first day of the month `n` months before `day`'s. */
function monthsBack(day: string, n: number): string {
  const [y, m] = day.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Inclusive `{from, to}` business days for a preset, relative to `today`.
 * "All time" is `{}` — the server spans every month it has.
 */
export function paymentPresetRange(preset: PaymentDatePreset, today: string): { from?: string; to?: string } {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "last_7_days":
      return { from: addDays(today, -6), to: today };
    case "last_14_days":
      return { from: addDays(today, -13), to: today };
    case "last_30_days":
    case "recent":
      return { from: addDays(today, -29), to: today };
    case "this_month":
      return { from: firstOfMonth(today), to: today };
    case "last_month": {
      const first = monthsBack(today, 1);
      return { from: first, to: addDays(firstOfMonth(today), -1) };
    }
    case "this_year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "last_year": {
      const y = Number(today.slice(0, 4)) - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    case "this_week_sun":
      return { from: addDays(today, -dow(today)), to: today };
    case "this_week_mon":
      return { from: addDays(today, -((dow(today) + 6) % 7)), to: today };
    case "last_week_sun": {
      const sunday = addDays(today, -dow(today) - 7);
      return { from: sunday, to: addDays(sunday, 6) };
    }
    case "last_week_mon":
    case "last_business_week": {
      const monday = addDays(today, -((dow(today) + 6) % 7) - 7);
      return { from: monday, to: addDays(monday, preset === "last_business_week" ? 4 : 6) };
    }
    case "last_3_months":
    case "last_6_months":
    case "last_12_months": {
      const n = preset === "last_3_months" ? 3 : preset === "last_6_months" ? 6 : 12;
      return { from: monthsBack(today, n), to: addDays(firstOfMonth(today), -1) };
    }
    case "all_time":
    case "custom":
    default:
      return {};
  }
}

/** Workiz's Custom rule: both ends, in order, at most twelve months. `null` = fine. */
export function customRangeError(from?: string, to?: string): string | null {
  if (!from || !to) return "Pick both dates";
  if (from > to) return "The start date is after the end date";
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > MAX_CUSTOM_DAYS) return "A custom range can span at most 12 months";
  return null;
}

/* ------------------------------------------------------------------ query */

/** `?from=…&types=a,b…` — lists as comma lists, empty values left out. */
export function buildPaymentReportQuery(q: PaymentReportQuery): string {
  const params = new URLSearchParams();
  const put = (k: string, v: string | number | undefined) => {
    if (v !== undefined && v !== "") params.set(k, String(v));
  };
  put("from", q.from);
  put("to", q.to);
  if (q.types?.length) put("types", q.types.join(","));
  if (q.technicianIds?.length) put("technicianIds", q.technicianIds.join(","));
  if (q.serviceAreaIds?.length) put("serviceAreaIds", q.serviceAreaIds.join(","));
  put("search", q.search?.trim());
  put("dir", q.dir);
  put("limit", q.limit);
  put("cursor", q.cursor);
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** Workiz's page sizes; it opens on 10. */
export const REPORT_PAGE_SIZES = [5, 10, 20, 25, 50, 100] as const;
export const DEFAULT_REPORT_PAGE_SIZE = 10;

/* ===================================================== the Payments report */

/** The presets Workiz adds on this report to the Jobs report's fifteen. */
type ExtraPreset = "last_3_months" | "last_6_months" | "last_12_months" | "all_time" | "recent";
export type PaymentsReportPreset = JobsReportPreset | ExtraPreset;

/**
 * Workiz's date box on the Payments report (rep_payments_wz_06_date_open):
 * the Jobs report's fifteen in the same words, then Last 3 months, Last six
 * months, Last twelve months, All time and "Recent (30 days, including
 * today)" — that last row wraps in the 250px box, as in Workiz.
 */
export const PAYMENTS_REPORT_PRESETS: { id: PaymentsReportPreset; label: string }[] = [
  ...JOBS_REPORT_PRESETS.map((p) => ({ id: p.id, label: p.label })),
  { id: "last_3_months", label: "Last 3 months" },
  { id: "last_6_months", label: "Last six months" },
  { id: "last_12_months", label: "Last twelve months" },
  { id: "all_time", label: "All time" },
  { id: "recent", label: "Recent (30 days, including today)" },
];

/** Workiz opens the report on this. */
export const DEFAULT_PAYMENTS_REPORT_PRESET: Exclude<PaymentsReportPreset, "custom"> = "this_month";

/** The first day of the month `n` months before `day`'s month. */
function monthStartBack(day: string, n: number): string {
  const [y, m] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 10);
}

/**
 * Inclusive days of a preset, counted from `today` on the viewer's clock as
 * Workiz's datepicker does (`report_table_and_datepicker.js` getOptions):
 * the Jobs report's presets as they are there; "Last N months" =
 * startOf("month") − N months … the end of last month; "Recent" =
 * subtract(30, "days") … today (31 days); "All time" = no days at all.
 */
export function paymentsReportRange(preset: Exclude<PaymentsReportPreset, "custom">, today: string): { from: string; to: string } {
  const endOfLastMonth = addDays(`${today.slice(0, 7)}-01`, -1);
  switch (preset) {
    case "last_3_months":
      return { from: monthStartBack(today, 3), to: endOfLastMonth };
    case "last_6_months":
      return { from: monthStartBack(today, 6), to: endOfLastMonth };
    case "last_12_months":
      return { from: monthStartBack(today, 12), to: endOfLastMonth };
    case "recent":
      return { from: addDays(today, -30), to: today };
    case "all_time":
      return { from: "", to: "" };
    default:
      return presetRange(preset, today);
  }
}

/** The box's days line: "All time" for All time (rep_payments_wz_16b_all_time), else Workiz's days. */
export function paymentsRangeText(range: WzDateRange): string {
  if (range.preset === "all_time" || (!range.from && !range.to)) return "All time";
  return formatWzDayRange(range.from, range.to);
}

/**
 * Whether the box's days can be asked for. Workiz's Custom: over twelve
 * months it says "Date range exceeds 12 months" inside the box and asks for
 * nothing (rep_payments_wz_16g_custom_over_year); with a day missing it just
 * waits. Any preset is fine.
 */
export function paymentsCustomCheck(range: WzDateRange): { usable: boolean; error: string | null } {
  if (range.preset !== "custom") return { usable: true, error: null };
  if (!range.from || !range.to) return { usable: false, error: null };
  const days = (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > MAX_CUSTOM_DAYS) return { usable: false, error: "Date range exceeds 12 months" };
  return { usable: true, error: null };
}

/** The three groups' picks, keyed by the query parameter each one fills. */
export interface PaymentsReportFilters {
  types?: string[];
  serviceAreaIds?: string[];
  technicianIds?: string[];
}

/** The report's question: the box, the filter, the search, the order and the page size. */
export function paymentsReportQuery({
  range,
  filters,
  search,
  dir,
  limit,
}: {
  range: WzDateRange;
  filters: PaymentsReportFilters;
  search: string;
  dir: "asc" | "desc";
  limit?: number;
}): Omit<PaymentReportQuery, "cursor"> {
  const q = search.trim();
  const list = (v?: string[]) => (v && v.length ? v : undefined);
  const types = list(filters.types);
  const serviceAreaIds = list(filters.serviceAreaIds);
  const technicianIds = list(filters.technicianIds);
  return {
    ...(range.from && { from: range.from }),
    ...(range.to && { to: range.to }),
    ...(types && { types }),
    ...(serviceAreaIds && { serviceAreaIds }),
    ...(technicianIds && { technicianIds }),
    ...(q && { search: q }),
    dir,
    ...(limit !== undefined && { limit }),
  };
}

/**
 * Workiz's "Filter results" (rep_payments_wz_05_filter_open): PAYMENT TYPE in
 * Workiz's order (Refund also takes Refund offline — the server expands it);
 * SERVICE AREAS A→Z regardless of case, without Workiz's default "All
 * areas", as chips in their own colours (the jobs list's `filterAreas`);
 * TECHNICIAN in the order given (Workiz's: who joined first — `orderTechs`).
 * A group with nothing to offer is left out. Chips
 * (rep_payments_wz_17c_chip_tech): the type alone ("Cash"), "metro: SURE
 * LOCK CT" in the area's colour, "technician: (2) CT - Tyler Boucher".
 */
export function paymentFilterGroups(
  areas: { id: string; name: string; color?: string }[],
  techs: { id: string; name: string }[],
): WzFilterGroup<keyof PaymentsReportFilters>[] {
  const groups: WzFilterGroup<keyof PaymentsReportFilters>[] = [
    {
      key: "types",
      label: "Payment type",
      chip: "",
      options: PAYMENT_REPORT_TYPE_FILTERS.map((f) => ({ value: f.value, label: f.label })),
    },
    {
      key: "serviceAreaIds",
      label: "Service Areas",
      chip: "metro",
      chipColored: true,
      options: filterAreas(areas).map((a) => ({ value: a.id, label: a.name, ...(a.color && { color: a.color }) })),
    },
    {
      key: "technicianIds",
      label: "Technician",
      chip: "technician",
      options: techs.map((t) => ({ value: t.id, label: t.name })),
    },
  ];
  return groups.filter((g) => g.options.length > 0);
}

/* ---------------------------------------------------------------- cells */

/** Refund types: Workiz's `cq.In` — their Amount and Tip print in parentheses. */
const REFUND_TYPES = new Set(["refund", "refund_offline"]);

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * An Amount / Tip cell, as Workiz's columns print it: a refund line in
 * parentheses ("($85.74)", its tip "($0.00)"), any other value as it is —
 * a negative Credit offline reads "-$207.00" (rep_payments_wz_15_sort_amount).
 */
export function paymentCellMoney(n: number, type: string): string {
  const v = Math.round((n || 0) * 100) / 100;
  return REFUND_TYPES.has(type) ? `(${usd(Math.abs(v))})` : usd(v);
}

/** A card's total: "$130,302.80"; below zero "-$1,149.40" (rep_payments_wz_20_refunds). */
export function paymentTotalMoney(n: number): string {
  return usd(Math.round((n || 0) * 100) / 100);
}

/**
 * The Payment date cell — Workiz's `buildDate(timestamp)`, "Thu, Oct 8,
 * 2026": the day only, on the account's clock (Workiz's timestamps are its
 * New York wall time; checked on 968 lines, 2026-10-09).
 */
export function paymentDay(iso: string, tz: string = DEFAULT_TZ): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
