import { dashboardPresetWindow, type DashboardPreset } from "@bitcrm/types";
import type { WzRangeOption } from "@/components/workiz/widget";

/**
 * Workiz Home's range picker, worded as Workiz words it (main.js `eEl`). Every
 * widget with a picker opens on the 14 days; Invoices adds "All time" and
 * opens on it. The days themselves are `dashboardPresetWindow`, shared with
 * the server so the nightly snapshots are found.
 */
export const WIDGET_RANGES: readonly WzRangeOption<DashboardPreset>[] = [
  { value: "this_week", label: "This week (Mon-Today)" },
  { value: "last_14_days", label: "Last 14 days" },
  { value: "this_month", label: "This month" },
  { value: "last_three", label: "Last 3 months" },
];

export type InvoiceRange = DashboardPreset | "all_time";

export const INVOICE_RANGES: readonly WzRangeOption<InvoiceRange>[] = [
  ...WIDGET_RANGES,
  { value: "all_time", label: "All time" },
];

export const DEFAULT_PRESET: DashboardPreset = "last_14_days";

export interface DayWindow {
  from: string;
  to: string;
}

/** The days behind a range, on the account's calendar; All time has none. */
export function rangeWindowOf(range: InvoiceRange, now: Date): DayWindow | undefined {
  return range === "all_time" ? undefined : dashboardPresetWindow(range, now);
}
