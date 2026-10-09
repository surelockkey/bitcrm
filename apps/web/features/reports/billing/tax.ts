import type { TaxReport, TaxReportBasis, TaxReportBy, TaxReportRow } from "@bitcrm/types";
import type { WzDateRange } from "@/components/workiz/date-range-picker";
import type { WzSortDir } from "@/components/workiz/report-grid";
import {
  PAYMENTS_REPORT_PRESETS,
  paymentsReportRange,
  type PaymentsReportPreset,
} from "@/features/payments/report";
import type { TaxReportParams } from "./lib";
import { money } from "./components/report-bits";

/*
 * Workiz Reports → Tax (`/root/tax_report/`), the rules of the page drawn as
 * Workiz draws it (rep_tax_wz_*, notes docs/import/app-parity-2026-10-08/rep_tax.md):
 * the date box, the sentence over the grid, the columns, the order of the
 * rows and the question each tab asks.
 */

/**
 * The date box: Workiz's twenty (the Payments report's list, the same words,
 * rep_tax_wz_07_date_open) without All time — the deal service windows a
 * report on at most twelve months of an index; All time would read every job
 * the account ever had (it needs daily tax aggregates first).
 */
export type TaxReportPreset = Exclude<PaymentsReportPreset, "all_time">;
export const TAX_REPORT_PRESETS = PAYMENTS_REPORT_PRESETS.filter(
  (p): p is { id: TaxReportPreset; label: string } => p.id !== "all_time",
);
/** Workiz opens each tab on This month. */
export const DEFAULT_TAX_REPORT_PRESET: Exclude<TaxReportPreset, "custom"> = "this_month";

/** A preset's days on the viewer's clock (Workiz's datepicker). */
export const taxPresetRange = (preset: Exclude<TaxReportPreset, "custom">, today: string) => paymentsReportRange(preset, today);

const KPI_WORDS: Record<TaxReportBasis, string> = {
  accrual: "total tax on sold items",
  paid: "total tax from collected payments",
};

/** The h3 over the grid: "$8,539.46 total tax on sold items" — "$0.00 …" with nothing found. */
export function taxKpi(basis: TaxReportBasis, total: number | undefined | null): string {
  return `${money(total ?? 0)} ${KPI_WORDS[basis]}`;
}

/** Workiz's `roundNicely(rate)%`: "10.00%", "8.88%". */
export const taxRateText = (rate: number): string => `${rate.toFixed(2)}%`;

export type TaxColumnId = "name" | "description" | "rate" | "amount" | "taxableAmount" | "nonTaxableAmount" | "jobs";

/** Accrual's seven, Paid's six (no Non-Taxable; the amount is headed "Tax"). */
export function taxColumnIds(basis: TaxReportBasis): TaxColumnId[] {
  return basis === "accrual"
    ? ["name", "description", "rate", "amount", "taxableAmount", "nonTaxableAmount", "jobs"]
    : ["name", "description", "rate", "amount", "taxableAmount", "jobs"];
}

const LABELS: Record<TaxColumnId, string> = {
  name: "Name",
  description: "Description",
  rate: "Rate",
  amount: "Amount",
  taxableAmount: "Taxable Amount",
  nonTaxableAmount: "Non-Taxable Amount",
  jobs: "Jobs",
};

export function taxColumnLabel(id: TaxColumnId, basis: TaxReportBasis): string {
  return id === "amount" && basis === "paid" ? "Tax" : LABELS[id];
}

export interface TaxGridSort {
  column: TaxColumnId;
  dir: WzSortDir;
}

/** Workiz opens both tabs on `sorted: [{name, desc: true}]` — the bar at the foot of Name. */
export const TAX_DEFAULT_SORT: TaxGridSort = { column: "name", dir: "desc" };

const collator = new Intl.Collator("en-US", { sensitivity: "base", numeric: true });

function compare(a: TaxReportRow, b: TaxReportRow, column: TaxColumnId): number {
  switch (column) {
    case "name":
      return collator.compare(a.name.trim(), b.name.trim()) || a.ratePercent - b.ratePercent;
    case "description":
      return collator.compare(a.description ?? "", b.description ?? "");
    case "rate":
      return a.ratePercent - b.ratePercent;
    default:
      return (a[column] ?? 0) - (b[column] ?? 0);
  }
}

/**
 * The rows in the order Workiz shows them for the bar on screen. Paid sorts
 * the way the bar says. **Accrual sorts backwards** — Workiz's server turns
 * every Accrual sort round (rep_tax_wz_10_sort_amount_1: Amount ascending
 * lists the largest first; the opening Name-descending lists A→Z) — and a
 * Workiz user knows the tab by those orders, so they are copied as seen.
 * Ties keep Name A→Z.
 */
export function orderTaxRows(rows: readonly TaxReportRow[], sort: TaxGridSort, basis: TaxReportBasis): TaxReportRow[] {
  const ascending = basis === "accrual" ? sort.dir === "desc" : sort.dir === "asc";
  const sign = ascending ? 1 : -1;
  const byName = [...rows].sort((a, b) => compare(a, b, "name"));
  return byName.sort((a, b) => sign * compare(a, b, sort.column));
}

/** "Tax to show": All taxes ("0", as Workiz), then each tax by its name alone. */
export function taxFilterOptions(taxes: TaxReport["taxes"]): { value: string; label: string }[] {
  return [{ value: "0", label: "All taxes" }, ...taxes.map((t) => ({ value: t.key, label: t.name }))];
}

/** A tab's question: By: only on Accrual; "0" (All taxes) and a blank search are left out. */
export function taxReportParams({
  basis,
  by,
  range,
  tax,
  search,
}: {
  basis: TaxReportBasis;
  by: TaxReportBy;
  range: Pick<WzDateRange, "from" | "to">;
  tax: string;
  search: string;
}): TaxReportParams {
  const q = search.trim();
  return {
    basis,
    ...(basis === "accrual" && { by }),
    from: range.from,
    to: range.to,
    ...(tax && tax !== "0" && { tax }),
    ...(q && { search: q }),
  };
}

/** Workiz's By: here (`report_by` 3 on this account). */
export const DEFAULT_TAX_BY: TaxReportBy = "end";

/** What a tab opens on (This month, Job end date, every tax) — both are fetched with the page. */
export function defaultTaxParams(basis: TaxReportBasis, today: string): TaxReportParams {
  return taxReportParams({
    basis,
    by: DEFAULT_TAX_BY,
    range: taxPresetRange(DEFAULT_TAX_REPORT_PRESET, today),
    tax: "0",
    search: "",
  });
}
