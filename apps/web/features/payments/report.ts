import {
  PAYMENT_REPORT_TYPE_FILTERS,
  type PaymentReportQuery,
} from "@bitcrm/types";
import { DEFAULT_TZ } from "@/lib/timezone";

/**
 * The Payments report's toolbar logic (Workiz Reports → Payments): the date
 * presets, the "Filter results" groups and the query they turn into. Days
 * are the business's (Eastern) days, the same clock the server buckets by.
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

/** Workiz opens the report on this. */
export const DEFAULT_PAYMENT_PRESET: PaymentDatePreset = "this_month";

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

/* ---------------------------------------------------------- filter groups */

/** One option of "Filter results": `type:<value>`, `area:<id>` or `tech:<id>`. */
export type ReportFilterKey = `type:${string}` | `area:${string}` | `tech:${string}`;

export interface ReportFilterOption {
  key: ReportFilterKey;
  label: string;
}

export interface ReportFilterGroup {
  heading: string;
  options: ReportFilterOption[];
}

/** Workiz's three groups: Payment type, Service Areas, Technician. */
export function reportFilterGroups(
  areas: { id: string; name: string }[],
  techs: { id: string; name: string }[],
): ReportFilterGroup[] {
  const groups: ReportFilterGroup[] = [
    {
      heading: "Payment type",
      options: PAYMENT_REPORT_TYPE_FILTERS.map((f) => ({ key: `type:${f.value}` as const, label: f.label })),
    },
  ];
  if (areas.length) {
    groups.push({
      heading: "Service Areas",
      options: [...areas]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((a) => ({ key: `area:${a.id}` as const, label: a.name })),
    });
  }
  if (techs.length) {
    groups.push({
      heading: "Technician",
      options: [...techs]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => ({ key: `tech:${t.id}` as const, label: t.name })),
    });
  }
  return groups;
}

/** The chosen options → the three query lists (OR inside each, AND between them). */
export function splitFilters(selected: Iterable<ReportFilterKey>): Pick<
  PaymentReportQuery,
  "types" | "technicianIds" | "serviceAreaIds"
> {
  const types: string[] = [];
  const serviceAreaIds: string[] = [];
  const technicianIds: string[] = [];
  for (const key of selected) {
    const i = key.indexOf(":");
    const kind = key.slice(0, i);
    const value = key.slice(i + 1);
    if (kind === "type") types.push(value);
    else if (kind === "area") serviceAreaIds.push(value);
    else if (kind === "tech") technicianIds.push(value);
  }
  return {
    ...(types.length && { types }),
    ...(serviceAreaIds.length && { serviceAreaIds }),
    ...(technicianIds.length && { technicianIds }),
  };
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

/* -------------------------------------------------------------- formatting */

/** Workiz writes money going out in parentheses: `($85.74)`. */
export function reportMoney(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return n < 0 ? `(${abs})` : abs;
}

/** `09/27/2026 9:28 PM` on the business clock. */
export function reportDateTime(iso: string, tz: string = DEFAULT_TZ): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString("en-US", { timeZone: tz, month: "2-digit", day: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  return `${date} ${time}`;
}

/** Workiz's page sizes; it opens on 10. */
export const REPORT_PAGE_SIZES = [5, 10, 20, 25, 50, 100] as const;
export const DEFAULT_REPORT_PAGE_SIZE = 10;
