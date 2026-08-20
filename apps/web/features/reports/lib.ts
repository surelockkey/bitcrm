import type { Contact, CustomFieldDefinition, Deal } from "@bitcrm/types";
import { filterDeals, jobDayKey, type DealFilter } from "@/features/deals/lib";

/* ------------------------------------------------------------- filtering */

export type JobsReportDateField = "createdAt" | "scheduledDate" | "closedAt";

export interface JobsReportFilter extends DealFilter {
  companyId?: string;
  createdBy?: string;
  subStatusId?: string;
  /** Which date the range applies to ("By: Job created / Job date"). */
  dateField?: JobsReportDateField;
  /** Inclusive ISO dates (YYYY-MM-DD). */
  dateFrom?: string;
  dateTo?: string;
}

/** The Jobs report rows: the regular deal filters plus report-only ones. */
export function filterJobsReport(
  deals: Deal[],
  filter: JobsReportFilter,
  contacts: Map<string, Contact>,
  customFieldDefs: CustomFieldDefinition[] = [],
): Deal[] {
  // The base filter applies dateFrom/dateTo to scheduledDate on its own —
  // keep the dates out of it so the report's field choice is authoritative.
  const { dateFrom, dateTo, dateField, companyId, createdBy, subStatusId, ...base } = filter;
  let rows = filterDeals(deals, base, contacts, customFieldDefs);
  if (companyId) rows = rows.filter((d) => d.companyId === companyId);
  if (createdBy) rows = rows.filter((d) => d.createdBy === createdBy);
  if (subStatusId) rows = rows.filter((d) => d.subStatusId === subStatusId);

  if (dateFrom || dateTo) {
    const field = dateField ?? "createdAt";
    rows = rows.filter((d) => {
      const day = jobDayKey(d, field);
      if (!day) return false;
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      return true;
    });
  }
  return rows;
}

/* ------------------------------------------------------------ pagination */

export function paginate<T>(
  rows: T[],
  page: number,
  size: number,
): { rows: T[]; page: number; pages: number; total: number } {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const clamped = Math.min(Math.max(1, page), pages);
  return {
    rows: rows.slice((clamped - 1) * size, clamped * size),
    page: clamped,
    pages,
    total,
  };
}

/* ---------------------------------------------------------- date presets */

export type DatePreset =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "all"
  | "custom";

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const shift = (day: string, days: number): string => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
};

/** Monday of the week containing `day`. */
function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  const dow = d.getUTCDay(); // 0 = Sunday
  return shift(day, dow === 0 ? -6 : 1 - dow);
}

/** Inclusive from/to for a preset, relative to `today` (Workiz semantics). */
export function datePresetRange(
  preset: DatePreset,
  today: string,
): { from?: string; to?: string } {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = shift(today, -1);
      return { from: y, to: y };
    }
    case "this_week":
      return { from: mondayOf(today), to: today };
    case "last_week": {
      const thisMonday = mondayOf(today);
      return { from: shift(thisMonday, -7), to: shift(thisMonday, -1) };
    }
    case "this_month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "last_month": {
      const firstOfThis = `${today.slice(0, 7)}-01`;
      const lastOfPrev = shift(firstOfThis, -1);
      return { from: `${lastOfPrev.slice(0, 7)}-01`, to: lastOfPrev };
    }
    default:
      return {};
  }
}

/* ---------------------------------------------------------------- export */

/** Rows of label → cell, serialized as CSV with a header from the first row. */
export function jobsReportCsv(rows: Record<string, string>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => cell(r[h] ?? "")).join(",")),
  ].join("\n");
}
