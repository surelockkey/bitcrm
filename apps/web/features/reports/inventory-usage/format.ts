/**
 * How the report prints its cells — Workiz's formats, so the two reports can
 * be read side by side.
 */

const QTY = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "1.00", "1,234.50" — Workiz prints every quantity with two decimals. */
export function formatQty(n: number | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? QTY.format(n) : "—";
}

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A job's scheduled day: "Tue Sep 29, 2026". A bare date is that calendar day
 * wherever the reader is — read as local midnight it would turn into the day
 * before west of Greenwich.
 */
export function formatJobDate(value: string | undefined): string {
  if (!value) return "—";
  const d = DAY_ONLY.test(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(DAY_ONLY.test(value) && { timeZone: "UTC" }),
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("month")} ${get("day")}, ${get("year")}`;
}

/** A moment, as Workiz's Return date and Time columns read: "Fri Oct 20 2023 10:41 am". */
export function formatDateTime(value: string | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("month")} ${get("day")} ${get("year")} ${get("hour")}:${get("minute")} ${get("dayPeriod").toLowerCase()}`;
}

const DAY_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** The window under the preset's name: "Jan 1, 2023 – Oct 20, 2023". */
export function rangeLabel(from: string, to: string): string {
  const day = (d: string) => DAY_LABEL.format(new Date(`${d}T00:00:00.000Z`));
  return `${day(from)} – ${day(to)}`;
}
