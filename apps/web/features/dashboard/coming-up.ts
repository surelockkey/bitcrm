import { DASHBOARD_TIMEZONE, type Deal } from "@bitcrm/types";
import { formatInstant, withZone, zonedInstant } from "@/lib/timezone";

/**
 * Workiz Home's "Coming up": the next visits on the schedule, from today on,
 * that are not done yet — four of them, by when they start.
 */

/** How many visits the widget lists (Workiz shows four). */
export const COMING_UP_COUNT = 4;

/**
 * When a visit starts: its day and the start of its time slot on the clock of
 * `timeZone`, the zone it was booked in (`jobZoneResolver`; the account's
 * New York when left out) — a Texas 10:00 is 11:00 in Connecticut; an
 * all-day or untimed visit at the start of its day; none for a job with no
 * date.
 */
export function visitStart(deal: Pick<Deal, "scheduledDate" | "scheduledTimeSlot">, timeZone = DASHBOARD_TIMEZONE): number | undefined {
  if (!deal.scheduledDate) return undefined;
  const start = deal.scheduledTimeSlot?.split("-")[0];
  return zonedInstant(deal.scheduledDate, /^\d{1,2}:\d{2}$/.test(start ?? "") ? start! : "00:00", timeZone).getTime();
}

/** "Oct 8, 11:15 AM EDT" — when a visit starts, on Connecticut's clock (2026-10-12 owner rule). */
export function visitWhen(at: number): string {
  return withZone(formatInstant(new Date(at).toISOString()), at);
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
 * each job once, the first four. Each visit is read on the clock of the zone
 * it was booked in (`zoneOf`, Connecticut when left out).
 */
export function comingUp(pages: Deal[][], zoneOf: (deal: Deal) => string = () => DASHBOARD_TIMEZONE): Deal[] {
  const seen = new Set<string>();
  const dated: { deal: Deal; at: number }[] = [];
  for (const deal of pages.flat()) {
    const at = visitStart(deal, zoneOf(deal));
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
