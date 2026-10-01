import type {
  CommissionReportBy,
  CommissionReportMode,
  CommissionReportRow,
  CommissionReportTotalKey,
} from "@bitcrm/types";

/* ----------------------------------------------------------- date presets */

/** Workiz's thirteen date presets on the Finance Reporting page, in its order. */
export const COMMISSION_DATE_PRESETS = [
  { id: "custom", label: "Custom" },
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "this_week_sun", label: "This week (Sun - Today)" },
  { id: "this_week_mon", label: "This week (Mon - Today)" },
  { id: "last_7_days", label: "Last 7 days" },
  { id: "last_week_sun", label: "Last week (Sun - Sat)" },
  { id: "last_week_mon", label: "Last week (Mon - Sun)" },
  { id: "last_business_week", label: "Last business week (Mon - Fri)" },
  { id: "last_14_days", label: "Last 14 days" },
  { id: "this_month", label: "This month" },
  { id: "last_30_days", label: "Last 30 days" },
  { id: "last_month", label: "Last month" },
] as const;

export type CommissionDatePreset = (typeof COMMISSION_DATE_PRESETS)[number]["id"];

const shift = (day: string, days: number): string => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/** 0 = Sunday … 6 = Saturday. */
const weekday = (day: string): number => new Date(`${day}T00:00:00.000Z`).getUTCDay();

/**
 * Inclusive `from` / `to` of a preset, relative to `today` (the business's
 * own day). "Last N days" end today, as Workiz's do. `custom` → nothing.
 */
export function commissionPresetRange(preset: CommissionDatePreset, today: string): { from?: string; to?: string } {
  const sunday = shift(today, -weekday(today));
  const monday = shift(today, weekday(today) === 0 ? -6 : 1 - weekday(today));
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: shift(today, -1), to: shift(today, -1) };
    case "this_week_sun":
      return { from: sunday, to: today };
    case "this_week_mon":
      return { from: monday, to: today };
    case "last_7_days":
      return { from: shift(today, -6), to: today };
    case "last_week_sun":
      return { from: shift(sunday, -7), to: shift(sunday, -1) };
    case "last_week_mon":
      return { from: shift(monday, -7), to: shift(monday, -1) };
    case "last_business_week":
      return { from: shift(monday, -7), to: shift(monday, -3) };
    case "last_14_days":
      return { from: shift(today, -13), to: today };
    case "this_month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "last_30_days":
      return { from: shift(today, -29), to: today };
    case "last_month": {
      const lastOfPrev = shift(`${today.slice(0, 7)}-01`, -1);
      return { from: `${lastOfPrev.slice(0, 7)}-01`, to: lastOfPrev };
    }
    default:
      return {};
  }
}

/** Today in a zone, `YYYY-MM-DD` — the business's day, not the browser's. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/* ------------------------------------------------------------------ query */

export interface CommissionReportFilters {
  from: string;
  to: string;
  by: CommissionReportBy;
  mode: CommissionReportMode;
  techId?: string;
  jobTypeId?: string;
  serviceAreaId?: string;
  /** A company id, or `only`. */
  externalCompanyId?: string;
  sourceId?: string;
  q?: string;
  sort?: string;
  dir?: "asc" | "desc";
  offset?: number;
  limit?: number;
}

/** The query string of `GET /deals/reports/commissions` (and `/export`): only what is set. */
export function commissionReportParams(f: CommissionReportFilters): Record<string, string> {
  const out: Record<string, string> = { from: f.from, to: f.to, by: f.by, mode: f.mode };
  const optional: Array<keyof CommissionReportFilters> = [
    "techId",
    "jobTypeId",
    "serviceAreaId",
    "externalCompanyId",
    "sourceId",
    "q",
    "sort",
    "dir",
  ];
  for (const key of optional) {
    const v = f[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim();
  }
  if (f.offset) out.offset = String(f.offset);
  if (f.limit) out.limit = String(f.limit);
  return out;
}

/* ---------------------------------------------------------------- columns */

export interface CommissionColumn {
  id: string;
  label: string;
  /** The server's sort key; no key = not sortable. */
  sort?: string;
  /** The Totals row's key, for a money column. */
  total?: CommissionReportTotalKey;
  numeric?: boolean;
  /** Shown until the viewer hides it in Fields (Workiz's defaults per mode). */
  default: boolean;
}

const col = (
  id: string,
  label: string,
  opts: Partial<Omit<CommissionColumn, "id" | "label">> = {},
): CommissionColumn => ({ id, label, default: true, ...opts });
const money = (id: CommissionReportTotalKey, label: string, dflt = true): CommissionColumn =>
  col(id, label, { sort: id, total: id, numeric: true, default: dflt });

/**
 * Every column a mode offers, in Workiz's order, and which ones it shows by
 * default (checked on the live report's Fields panel, 2026-09-29).
 */
export function commissionColumns(mode: CommissionReportMode): CommissionColumn[] {
  const head = [col("dealNumber", "Job Id", { sort: "dealNumber" })];
  const tail = [
    col("externalCompanyName", "Company Name", { default: mode === "external" }),
    col("sourceName", "Ad Group", { default: false }),
    col("clientName", "Client", { sort: "clientName", default: false }),
  ];
  if (mode === "external") {
    return [
      ...head,
      col("createdAt", "Created", { sort: "createdAt" }),
      col("scheduledDate", "Scheduled", { sort: "scheduledDate" }),
      col("closedDate", "Closed", { sort: "closedDate" }),
      col("jobTypeName", "Job Type", { sort: "jobTypeName" }),
      col("address", "Address", { sort: "address" }),
      money("total", "Total"),
      money("cash", "Cash"),
      money("credit", "Credit"),
      money("billing", "Billing"),
      money("check", "Check"),
      money("parts", "Parts"),
      money("companyParts", "Company Parts"),
      money("externalCompanyProfit", "External Company Profit"),
      col("externalBalance", "Balance", { numeric: true }),
      money("tax", "Tax"),
      money("cashByExternal", "Cash By External", false),
      col("techName", "Tech", { sort: "techName", default: false }),
      ...tail,
    ];
  }
  const tech = mode === "tech";
  return [
    ...head,
    col("techName", "Tech", { sort: "techName" }),
    col("createdAt", "Created", { sort: "createdAt", default: tech }),
    col("scheduledDate", "Scheduled", { sort: "scheduledDate", default: !tech }),
    col("closedDate", "Closed", { sort: "closedDate" }),
    col("jobTypeName", "Job Type", { sort: "jobTypeName" }),
    col("address", "Address", { sort: "address" }),
    money("total", "Total"),
    money("cash", "Cash"),
    money("credit", "Credit"),
    money("billing", "Billing"),
    money("check", "Check"),
    col("rate", "Tech Share", { sort: "rate", default: !tech }),
    money("tip", "Tip Amount"),
    money("parts", "Parts"),
    money("companyParts", "Company Parts"),
    money("techProfit", "Tech Profit"),
    ...(tech ? [money("balance", "Balance Tech")] : []),
    money("externalCompanyProfit", "External Company Profit", false),
    ...(tech ? [] : [money("companyProfit", "Company Profit")]),
    money("tax", "Tax"),
    money("cashByExternal", "Cash By External", false),
    money("creditByExternal", "Credit By External", false),
    money("billingByExternal", "Billing By External", false),
    money("checkByExternal", "Check By External", false),
    ...tail,
  ];
}

/* ---------------------------------------------------------------- display */

export const formatMoney = (n: number | undefined): string =>
  (n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "50%" or "165$" — a rate, as Workiz's Tech Share column prints it. */
export function rateLabel(row: Pick<CommissionReportRow, "rate" | "rateUnit">): string {
  if (row.rate === undefined || row.rate === null) return "—";
  return row.rateUnit === "$" ? `${row.rate}$` : `${row.rate}%`;
}

/** `2026-09-02` + `19:00` → "09/02/2026 07:00 PM". */
export function formatDayTime(day?: string, time?: string): string {
  if (!day) return "—";
  const [y, m, d] = day.split("-");
  const date = `${m}/${d}/${y}`;
  if (!time || !/^\d{2}:\d{2}/.test(time)) return date;
  const [hh, mm] = time.slice(0, 5).split(":").map(Number);
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${date} ${String(h12).padStart(2, "0")}:${String(mm).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
}

/** A row's cell as text (the table and print). */
export function cellText(row: CommissionReportRow, columnId: string): string {
  switch (columnId) {
    case "createdAt": {
      if (!row.createdAt) return "—";
      const d = new Date(row.createdAt);
      return Number.isNaN(d.getTime())
        ? row.createdAt
        : d.toLocaleString("en-US", { month: "2-digit", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    }
    case "scheduledDate":
      return formatDayTime(row.scheduledDate, row.scheduledTimeSlot?.slice(0, 5));
    case "closedDate":
      return formatDayTime(row.closedDate, row.closedTime);
    case "rate":
      return rateLabel(row);
    case "externalBalance":
      return formatMoney(-row.cashByExternal);
    default: {
      const v = (row as unknown as Record<string, unknown>)[columnId];
      if (typeof v === "number") return formatMoney(v);
      return typeof v === "string" && v ? v : "—";
    }
  }
}

/* ----------------------------------------------------------------- fields */

const FIELDS_KEY = "bitcrm.commissions.fields";

export type ColumnChoices = Partial<Record<CommissionReportMode, Record<string, boolean>>>;

/**
 * The columns the viewer switched on or off in Fields, per mode — kept in the
 * browser (Workiz keeps them per user on its server). Anything unusable in
 * the store is dropped, never trusted.
 */
export function loadColumnChoices(): ColumnChoices {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(FIELDS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: ColumnChoices = {};
    for (const mode of ["standard", "tech", "external"] as const) {
      const entry = (parsed as Record<string, unknown>)[mode];
      if (!entry || typeof entry !== "object") continue;
      out[mode] = Object.fromEntries(
        Object.entries(entry as Record<string, unknown>).filter(([, v]) => typeof v === "boolean"),
      ) as Record<string, boolean>;
    }
    return out;
  } catch {
    // A private window, or blocked site data: Workiz's defaults, until reload.
    return {};
  }
}

export function saveColumnChoices(choices: ColumnChoices): void {
  try {
    localStorage.setItem(FIELDS_KEY, JSON.stringify(choices));
  } catch {
    // Not remembered — the page still works.
  }
}

/** Visible columns: the viewer's choice where made, else Workiz's default. */
export function visibleColumns(mode: CommissionReportMode, choice: Record<string, boolean>): CommissionColumn[] {
  return commissionColumns(mode).filter((c) => choice[c.id] ?? c.default);
}
