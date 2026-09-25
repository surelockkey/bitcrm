import { SUPER_STATUS_ORDER, type JobSuperStatus } from "@bitcrm/types";
import { superStatusLabel } from "@/features/deals/lib";

/** The dashboard's period choices — every one fits the server's 92-day window. */
export type DashboardPeriod = "today" | "last_7" | "last_30" | "last_90" | "this_month" | "last_month";

export const DASHBOARD_PERIODS: { value: DashboardPeriod; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "last_7", label: "Last 7 days" },
  { value: "last_30", label: "Last 30 days" },
  { value: "last_90", label: "Last 90 days" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
];

/** Workiz opens its dashboard on the last thirty days. */
export const DEFAULT_PERIOD: DashboardPeriod = "last_30";

const shift = (day: string, days: number): string => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Inclusive YYYY-MM-DD bounds of a period ending `today`. */
export function periodWindow(period: DashboardPeriod, today: string): { from: string; to: string } {
  switch (period) {
    case "today":
      return { from: today, to: today };
    case "last_7":
      return { from: shift(today, -6), to: today };
    case "last_90":
      return { from: shift(today, -89), to: today };
    case "this_month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "last_month": {
      const lastOfPrev = shift(`${today.slice(0, 7)}-01`, -1);
      return { from: `${lastOfPrev.slice(0, 7)}-01`, to: lastOfPrev };
    }
    default:
      return { from: shift(today, -29), to: today };
  }
}

/** A tile's amount: whole dollars under ten thousand, then 12.9K / 128K / 4.2M. */
export function compactMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a < 10_000) return `${sign}$${Math.round(a).toLocaleString("en-US")}`;
  const [value, unit] = a >= 1_000_000 ? [a / 1_000_000, "M"] : [a / 1_000, "K"];
  const digits = value >= 100 ? 0 : 1;
  return `${sign}$${Number(value.toFixed(digits)).toLocaleString("en-US")}${unit}`;
}

/** What a breakdown row is called: its name, else its key, and "Not set" for none. */
export function bucketLabel(key: string, names: Record<string, string | undefined>): string {
  if (!key) return "Not set";
  return names[key] ?? key;
}

/** The status breakdown in board order. */
export function statusRows(byStatus: Record<JobSuperStatus, number>) {
  return SUPER_STATUS_ORDER.map((status) => ({
    status,
    label: superStatusLabel(status),
    count: byStatus[status] ?? 0,
  }));
}
