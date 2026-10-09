import {
  DEFAULT_TIMEZONE,
  type CommissionReport,
  type CommissionReportBy,
  type CommissionReportMode,
  type CommissionReportRow,
  type CommissionReportTechSummary,
  type CommissionReportTotalKey,
} from "@bitcrm/types";
import { personName } from "@/features/deals/person-name";

/*
 * Workiz's "Commissions (Legacy)" — Finance Reporting — on the web: the
 * period presets, the request, the columns of each mode and how Workiz prints
 * every figure. Measured on the live report (rep_commission_wz_*, 2026-10-09).
 */

/* ----------------------------------------------------------- date presets */

/** Workiz's thirteen date presets on the Finance Reporting page, in its order and its spelling. */
export const COMMISSION_DATE_PRESETS = [
  { id: "custom", label: "Custom" },
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "this_week_sun", label: "This week(Sun - Today)" },
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
/** The same day a month back, overflowing as PHP's `-1 month` does (Mar 31 → Feb 31 → Mar 3). */
const monthBack = (day: string): string => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, d)).toISOString().slice(0, 10);
};
/** 0 = Sunday … 6 = Saturday. */
const weekday = (day: string): number => new Date(`${day}T00:00:00.000Z`).getUTCDay();

/**
 * Inclusive `from` / `to` of a preset, relative to `today` (the business's
 * own day). Workiz's "Last N days" END YESTERDAY (live 2026-10-09: Last 7
 * days = Oct 02 – Oct 08), and "Last 30 days" starts on the same day last
 * month. `custom` → nothing.
 */
export function commissionPresetRange(preset: CommissionDatePreset, today: string): { from?: string; to?: string } {
  const sunday = shift(today, -weekday(today));
  const monday = shift(today, weekday(today) === 0 ? -6 : 1 - weekday(today));
  const yesterday = shift(today, -1);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: yesterday, to: yesterday };
    case "this_week_sun":
      return { from: sunday, to: today };
    case "this_week_mon":
      return { from: monday, to: today };
    case "last_7_days":
      return { from: shift(today, -7), to: yesterday };
    case "last_week_sun":
      return { from: shift(sunday, -7), to: shift(sunday, -1) };
    case "last_week_mon":
      return { from: shift(monday, -7), to: shift(monday, -1) };
    case "last_business_week":
      return { from: shift(monday, -7), to: shift(monday, -3) };
    case "last_14_days":
      return { from: shift(today, -14), to: yesterday };
    case "this_month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "last_30_days":
      return { from: monthBack(today), to: yesterday };
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
  /** `1` re-reads the period (the grid's reload button). */
  fresh?: string;
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
    "fresh",
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
  /** An amount or a rate: shown only with `financials.view`. */
  money?: boolean;
  /** Shown until the viewer hides it in Fields (Workiz's live defaults per mode, 2026-10-09). */
  default: boolean;
}

const col = (
  id: string,
  label: string,
  opts: Partial<Omit<CommissionColumn, "id" | "label">> = {},
): CommissionColumn => ({ id, label, default: true, ...opts });
const money = (id: CommissionReportTotalKey, label: string, dflt = true): CommissionColumn =>
  col(id, label, { sort: id, total: id, money: true, default: dflt });

/**
 * Every column a mode offers — Workiz's Fields list of that mode, in its
 * order — and which are on by default (rep_commission_wz_07_fields_open,
 * _13_tech_fields, _15_external_fields). Not here: Invoice / Invoice Number,
 * Company Share, Fees By Company and Settled (BitCRM keeps no invoice number
 * on the row, no external-company rates and no settling). Without `withMoney`
 * the amounts and the rate are left out.
 */
export function commissionColumns(mode: CommissionReportMode, withMoney = true): CommissionColumn[] {
  const all = modeColumns(mode);
  return withMoney ? all : all.filter((c) => !c.money);
}

function modeColumns(mode: CommissionReportMode): CommissionColumn[] {
  const head = col("dealNumber", "Job Id", { sort: "dealNumber" });
  const paid = [money("total", "Total"), money("cash", "Cash"), money("credit", "Credit"), money("billing", "Billing"), money("check", "Check")];
  const where = [col("jobTypeName", "Job Type", { sort: "jobTypeName" }), col("address", "Address", { sort: "address" })];
  const client = (dflt: boolean) => col("clientName", "Client", { sort: "clientName", default: dflt });
  if (mode === "external") {
    return [
      head,
      col("createdAt", "Created", { sort: "createdAt" }),
      col("scheduledDate", "Scheduled", { sort: "scheduledDate" }),
      col("closedDate", "Closed", { sort: "closedDate" }),
      ...where,
      ...paid,
      money("parts", "Parts"),
      money("companyParts", "Company Parts"),
      money("externalCompanyProfit", "External Company Profit"),
      col("externalBalance", "Balance", { money: true }),
      money("tax", "Tax"),
      col("externalCompanyName", "Company Name"),
      client(false),
    ];
  }
  const tech = mode === "tech";
  const rate = col("rate", "Tech Share", { sort: "rate", money: true });
  return [
    head,
    col("techName", "Tech", { sort: "techName" }),
    col("createdAt", "Created", { sort: "createdAt", default: tech }),
    col("scheduledDate", "Scheduled", { sort: "scheduledDate", default: !tech }),
    col("closedDate", "Closed", { sort: "closedDate" }),
    ...where,
    ...paid,
    rate,
    money("tip", "Tip Amount"),
    money("parts", "Parts"),
    money("companyParts", "Company Parts"),
    money("techProfit", "Tech Profit"),
    ...(tech
      ? [money("balance", "Balance Tech"), money("tax", "Tax"), client(false)]
      : [
          money("externalCompanyProfit", "External Company Profit", false),
          money("companyProfit", "Company Profit"),
          money("tax", "Tax"),
          col("externalCompanyName", "Company Name", { default: false }),
          col("sourceName", "Ad Group", { default: false }),
          client(true),
        ]),
  ];
}

/* -------------------------------------------------------------- printing */

const plain = (n: number, digits: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const whole = (n: number) => Number.isInteger(Math.round(n * 100) / 100);

/** A grid cell: thousands, two decimals unless whole ("5,802", "202.50", "0", "-0.59"). */
export function wzCellMoney(n: number | undefined): string {
  const v = n ?? 0;
  return whole(v) ? plain(Math.round(v), 0) : plain(v, 2);
}

/** The Totals row: no thousands, `toFixed(2)` only when there are cents ("115533.77", "2000"). */
export function wzTotalNumber(n: number | undefined): string {
  const v = Math.round((n ?? 0) * 100) / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/** Total Profits / Total by type: the number as it is ("22282.61", "157.5", "0"). */
export function wzRawNumber(n: number | undefined): string {
  return String(Math.round((n ?? 0) * 100) / 100);
}

/** "50%" or "165$" — a rate, as Workiz's Tech Share column prints it. */
export function rateLabel(row: Pick<CommissionReportRow, "rate" | "rateUnit">): string {
  if (row.rate === undefined || row.rate === null) return "";
  return row.rateUnit === "$" ? `${row.rate}$` : `${row.rate}%`;
}

/** `2026-09-02` + `19:00` → "09/02/2026 07:00 PM". */
export function formatDayTime(day?: string, time?: string): string {
  if (!day) return "";
  const [y, m, d] = day.split("-");
  const date = `${m}/${d}/${y}`;
  if (!time || !/^\d{2}:\d{2}/.test(time)) return date;
  const [hh, mm] = time.slice(0, 5).split(":").map(Number);
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${date} ${String(h12).padStart(2, "0")}:${String(mm).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
}

/** An instant on the business's clock (Workiz's account zone), "09/24/2026 03:06 PM". */
function businessDayTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: DEFAULT_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return formatDayTime(`${parts.year}-${parts.month}-${parts.day}`, `${hour}:${parts.minute}`);
}

/** A row's cell as text (the grid and print). */
export function cellText(row: CommissionReportRow, columnId: string): string {
  switch (columnId) {
    case "createdAt":
      return row.createdAt ? businessDayTime(row.createdAt) : "";
    case "scheduledDate":
      return formatDayTime(row.scheduledDate, row.scheduledTimeSlot?.slice(0, 5));
    case "closedDate":
      return formatDayTime(row.closedDate, row.closedTime);
    case "rate":
      return rateLabel(row);
    case "externalBalance":
      return wzCellMoney(-row.cashByExternal);
    default: {
      const v = (row as unknown as Record<string, unknown>)[columnId];
      if (typeof v === "number") return wzCellMoney(v);
      return typeof v === "string" ? v : "";
    }
  }
}

/* ------------------------------------------------------- totals, summaries */

/**
 * The Totals row's cell under a column: "Totals:<N>" in the first, the sum
 * under a money column, nothing elsewhere — and no sums at all when the
 * period has no row (Workiz's `totals` is then empty).
 */
export function totalsCell(
  report: Pick<CommissionReport, "count" | "totals">,
  column: CommissionColumn,
  index: number,
): string {
  if (index === 0) return `Totals:${report.count}`;
  if (report.count === 0) return "";
  if (column.total) return wzTotalNumber(report.totals[column.total].amount);
  if (column.id === "externalBalance") return wzTotalNumber(-report.totals.cashByExternal.amount);
  return "";
}

export interface SummaryRow {
  label: string;
  key: CommissionReportTotalKey;
}

/** Total Profits: what Workiz lists in each mode; nothing for an empty period. */
export function profitRows(mode: CommissionReportMode, count: number): SummaryRow[] {
  if (count === 0) return [];
  if (mode === "tech") return [{ label: "tech profit", key: "techProfit" }];
  if (mode === "external") return [{ label: "external company profit", key: "externalCompanyProfit" }];
  return [
    { label: "external company profit", key: "externalCompanyProfit" },
    { label: "company profit", key: "companyProfit" },
    { label: "tech profit", key: "techProfit" },
  ];
}

/** Total by type: the eight Workiz always lists; nothing for an empty period. */
export function typeRows(count: number): SummaryRow[] {
  if (count === 0) return [];
  return [
    { label: "cash", key: "cash" },
    { label: "credit", key: "credit" },
    { label: "billing", key: "billing" },
    { label: "check", key: "check" },
    { label: "cash by external", key: "cashByExternal" },
    { label: "credit by external", key: "creditByExternal" },
    { label: "billing by external", key: "billingByExternal" },
    { label: "check by external", key: "checkByExternal" },
  ];
}

/**
 * DataTables' line under the grid. Workiz's server answers the page's own
 * row count as the "total", so "(filtered from N total entries)" follows
 * whenever the period has more rows than the page.
 */
export function commissionInfo(page: number, size: number, count: number): string {
  if (count === 0) return "Showing 0 to 0 of 0 entries";
  const first = (page - 1) * size + 1;
  const last = Math.min(count, page * size);
  const onPage = last - first + 1;
  const fmt = (n: number) => n.toLocaleString("en-US");
  return `Showing ${fmt(first)} to ${fmt(last)} of ${fmt(count)} entries${onPage < count ? ` (filtered from ${fmt(onPage)} total entries)` : ""}`;
}

/* ------------------------------------------------------------ technicians */

export interface CommissionTechOption {
  value: string;
  label: string;
}

/**
 * Workiz's "Select Technician": every user of the account by name, and
 * "   [N]" after each one with jobs in the period (its `tech_marker`). A
 * technician the directory does not hold (archived, or no right to list
 * users) still comes from the report.
 */
export function commissionTechOptions(
  users: ReadonlyArray<{ id: string; firstName?: string; lastName?: string; workizName?: string; email?: string }>,
  techs: ReadonlyArray<Pick<CommissionReportTechSummary, "techId" | "techName" | "jobs">>,
): CommissionTechOption[] {
  const jobs = new Map(techs.map((t) => [t.techId, t.jobs]));
  const named = new Map<string, string>();
  for (const u of users) named.set(u.id, personName(u) ?? u.id);
  for (const t of techs) if (!named.has(t.techId)) named.set(t.techId, t.techName ?? t.techId);
  return [...named.entries()]
    .sort(([, a], [, b]) => a.localeCompare(b))
    .map(([value, name]) => ({ value, label: jobs.get(value) ? `${name}   [${jobs.get(value)}]` : name }));
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

/** Visible columns: the viewer's choice where made, else Workiz's default; amounts only `withMoney`. */
export function visibleColumns(
  mode: CommissionReportMode,
  choice: Record<string, boolean>,
  withMoney = true,
): CommissionColumn[] {
  return commissionColumns(mode, withMoney).filter((c) => choice[c.id] ?? c.default);
}
