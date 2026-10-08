import { DASHBOARD_TIMEZONE, type Deal } from "@bitcrm/types";

/**
 * Workiz Home's "Coming up": the next visits on the schedule, from today on,
 * that are not done yet — four of them, by when they start.
 */

/** How many visits the widget lists (Workiz shows four). */
export const COMING_UP_COUNT = 4;

/** How far `timeZone` is ahead of UTC at `instant`, in ms. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, Number(p.value)]),
  );
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - instant;
}

/**
 * When a visit starts: its day and the start of its time slot on the
 * account's clock (New York); an all-day or untimed visit at the start of its
 * day; none for a job with no date.
 */
export function visitStart(deal: Pick<Deal, "scheduledDate" | "scheduledTimeSlot">, timeZone = DASHBOARD_TIMEZONE): number | undefined {
  if (!deal.scheduledDate) return undefined;
  const [y, m, d] = deal.scheduledDate.split("-").map(Number);
  const [hh, mm] = (deal.scheduledTimeSlot?.split("-")[0] ?? "00:00").split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, hh || 0, mm || 0);
  // Twice: the first guess can sit on the other side of a clock change.
  const first = naive - offsetAt(naive, timeZone);
  return naive - offsetAt(first, timeZone);
}

/** "271 Dunham St Southington Connecticut" — street, city, state, as Workiz prints the line. */
export function visitStreet(deal: Pick<Deal, "address">): string {
  const a = deal.address;
  return [a?.street, a?.city, a?.state]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * The open statuses' first pages, merged in visit order: dated visits only,
 * each job once, the first four.
 */
export function comingUp(pages: Deal[][]): Deal[] {
  const seen = new Set<string>();
  const dated: { deal: Deal; at: number }[] = [];
  for (const deal of pages.flat()) {
    const at = visitStart(deal);
    if (at === undefined || seen.has(deal.id)) continue;
    seen.add(deal.id);
    dated.push({ deal, at });
  }
  return dated
    .sort((a, b) => a.at - b.at)
    .slice(0, COMING_UP_COUNT)
    .map((d) => d.deal);
}

/**
 * moment's `fromNow`, which Workiz prints on the widget: "7 hours ago",
 * "in 2 hours", "a day ago". `delta` is the moment minus now, in ms.
 */
export function fromNow(delta: number): string {
  const s = Math.abs(delta) / 1000;
  const m = Math.round(s / 60);
  const h = Math.round(m / 60);
  const d = Math.round(h / 24);
  let words: string;
  if (s < 45) words = "a few seconds";
  else if (s < 90) words = "a minute";
  else if (m < 45) words = `${m} minutes`;
  else if (m < 90) words = "an hour";
  else if (h < 22) words = `${h} hours`;
  else if (h < 36) words = "a day";
  else if (d < 26) words = `${d} days`;
  else if (d < 45) words = "a month";
  else if (d < 320) words = `${Math.round(d / 30.4)} months`;
  else if (d < 548) words = "a year";
  else words = `${Math.round(d / 365)} years`;
  return delta < 0 ? `${words} ago` : `in ${words}`;
}
