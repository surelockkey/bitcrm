import type {
  AgingBucket,
  AgingSort,
  EstimateStatus,
  InvoiceDaysDue,
  InvoiceReportStatus,
  TaxReportBasis,
  TaxReportBy,
} from "@bitcrm/types";
import { PAYMENT_DATE_PRESETS, type PaymentDatePreset } from "@/features/payments/report";

/**
 * Query building and small rules of the billing report pages (Workiz's Aging
 * invoices, Tax, Invoices and Estimates). The date presets are the Payments
 * report's (`@/features/payments/report`) — the same Workiz list, the same
 * business-day clock; each page keeps only the ones Workiz offers there.
 */

export type DatePreset = PaymentDatePreset;

const pick = (keep: (v: DatePreset) => boolean) => PAYMENT_DATE_PRESETS.filter((p) => keep(p.value));

/** The Invoices page: Workiz's full list; opens on All time. */
export const INVOICE_DATE_PRESETS = PAYMENT_DATE_PRESETS;
export const DEFAULT_INVOICE_PRESET: DatePreset = "all_time";

/**
 * The Estimates page, as seen live 2026-09-29: All time (the default), Custom
 * and the day/week/month/year presets — no Last 3/6/12 months, no Recent.
 */
export const ESTIMATE_DATE_PRESETS = pick(
  (v) => !["last_3_months", "last_6_months", "last_12_months", "recent"].includes(v),
);
export const DEFAULT_ESTIMATE_PRESET: DatePreset = "all_time";

/** `?a=1&list=x,y` — lists as comma lists, empty values left out. */
export function toQuery(params: Record<string, string | number | string[] | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      if (v.length) q.set(k, v.join(","));
    } else q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

// ---------------------------------------------------------------- aging

export interface AgingParams {
  bucket?: AgingBucket;
  sort?: AgingSort;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

// -------------------------------------------------------------- invoices

export interface InvoiceReportParams {
  from?: string;
  to?: string;
  statuses?: InvoiceReportStatus[];
  daysDue?: InvoiceDaysDue[];
  sent?: Array<"sent" | "unsent">;
  search?: string;
  limit?: number;
  cursor?: string;
}

/** One option of the Invoices page's "Filter results": `status:due`, `days:0_30`, `sent:unsent`. */
export type InvoiceFilterKey = `status:${InvoiceReportStatus}` | `days:${InvoiceDaysDue}` | `sent:${"sent" | "unsent"}`;

/** The chosen options → the three query lists (OR inside a group, AND between groups). */
export function splitInvoiceFilters(keys: Iterable<InvoiceFilterKey>): Pick<InvoiceReportParams, "statuses" | "daysDue" | "sent"> {
  const statuses: InvoiceReportStatus[] = [];
  const daysDue: InvoiceDaysDue[] = [];
  const sent: Array<"sent" | "unsent"> = [];
  for (const key of keys) {
    const i = key.indexOf(":");
    const group = key.slice(0, i);
    const value = key.slice(i + 1);
    if (group === "status") statuses.push(value as InvoiceReportStatus);
    else if (group === "days") daysDue.push(value as InvoiceDaysDue);
    else if (group === "sent") sent.push(value as "sent" | "unsent");
  }
  return {
    ...(statuses.length && { statuses }),
    ...(daysDue.length && { daysDue }),
    ...(sent.length && { sent }),
  };
}

// ------------------------------------------------------------- estimates

export interface EstimateReportParams {
  from?: string;
  to?: string;
  status?: EstimateStatus;
  search?: string;
  /** Created order; the server's own is newest first (`desc`). */
  dir?: "asc" | "desc";
  limit?: number;
  cursor?: string;
}

/** Workiz's status colours (the Estimates cards and badges). */
export const ESTIMATE_STATUS_COLORS: Record<EstimateStatus, string> = {
  unsent: "#D574E4",
  pending: "#FBAB33",
  approved: "#6AA8EE",
  declined: "#FF6F64",
  won: "#3ACF7D",
  archived: "#9EA6AA",
};

// ------------------------------------------------------------------ tax

export interface TaxReportParams {
  basis: TaxReportBasis;
  by?: TaxReportBy;
  from: string;
  to: string;
  tax?: string;
  search?: string;
}

// -------------------------------------------------------------- download

/** Hands the browser a CSV the API built. No-op where the DOM cannot (tests). */
export function downloadCsv(filename: string, csv: string): void {
  if (typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** "Thu Jan 19, 2023" — how Workiz prints a date in these reports. */
export function workizDate(value: string | undefined, tz = "America/New_York"): string {
  if (!value) return "";
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = new Date(ymd ? `${value}T12:00:00.000Z` : value);
  if (Number.isNaN(d.getTime())) return value;
  const zone = ymd ? "UTC" : tz;
  const wd = d.toLocaleDateString("en-US", { timeZone: zone, weekday: "short" });
  const md = d.toLocaleDateString("en-US", { timeZone: zone, month: "short", day: "2-digit", year: "numeric" });
  return `${wd} ${md}`;
}

/** "Fri Sep 11, 2026 03:39 am" — Workiz's Created cell, on the business clock. */
export function workizDateTime(iso: string | undefined, tz = "America/New_York"): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = d
    .toLocaleTimeString("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: true })
    .toLowerCase();
  return `${workizDate(iso, tz)} ${time}`;
}
