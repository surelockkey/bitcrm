import { JobSuperStatus, type Address, type Deal } from "@bitcrm/types";
import { DEFAULT_TZ, offsetAt, wallToCt, withZone } from "@/lib/timezone";
import { US_STATES } from "@/features/deals/components/workiz/options";
import { jobZoneResolver } from "@/features/service-areas/lib";

/**
 * The Map's words, as Workiz prints them on its job cards, pin cards and tech
 * cards (pg_dispatch_wz_02 / _05 / _13).
 */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATE_NAMES = new Map(US_STATES.map(([code, name]) => [code, name]));

const collapse = (s: string | undefined) => (s ?? "").trim().replace(/\s+/g, " ");

/** "Car Key Copy - Job #A4IC4E"; "Job #A4IC4E" for a job without a type. */
export function jobCardTitle(jobTypeName: string, dealNumber: string): string {
  const type = collapse(jobTypeName);
  return type && type !== "—" ? `${type} - Job #${dealNumber}` : `Job #${dealNumber}`;
}

/** "301 Humphrey St, New Haven, Connecticut, 06511" — the state spelled out. */
export function mapAddress(address: Partial<Pick<Address, "street" | "unit" | "city" | "state" | "zip">>): string {
  const street = collapse([address.street, address.unit].filter(Boolean).join(" "));
  const state = address.state ? (STATE_NAMES.get(address.state.toUpperCase()) ?? address.state) : "";
  return [street, collapse(address.city), state, collapse(address.zip)].filter(Boolean).join(", ");
}

/** "Fri Oct 09" from YYYY-MM-DD. */
function cardDay(isoDay: string): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return `${DAYS[date.getUTCDay()]} ${MONTHS[date.getUTCMonth()]} ${String(d).padStart(2, "0")}`;
}

/** "07:30" → "7:30 am", "21:00" → "9:00 pm". */
function clock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** `(job) => zone` its visit was booked in — `jobZoneResolver` over the areas. */
export type JobZoneOf = ReturnType<typeof jobZoneResolver>;

/** Without the areas: the job's own `jobTimezone`, else Connecticut. */
export const JOB_ZONE: JobZoneOf = jobZoneResolver(undefined);

/**
 * "Fri Oct 09 7:30 am - 8:30 am EDT" — the pin card's schedule line.
 *
 * Ours since 2026-10-12 (owner rule): on Connecticut's clock, labelled. The
 * visit is stored on the clock of `zone`, the one it was booked in (the map
 * row carries `jobTimezone` / `serviceAreaId` for `jobZoneResolver`): a Texas
 * 10:00 reads 11:00 am EDT. A day without times stays a date.
 */
export function pinCardWhen(
  deal: Pick<Deal, "scheduledDate" | "scheduledEndDate" | "scheduledTimeSlot" | "allDay">,
  zone: string = DEFAULT_TZ,
): string {
  if (!deal.scheduledDate) return "";
  const slot = deal.allDay ? undefined : deal.scheduledTimeSlot;
  if (!slot || !slot.includes("-")) return cardDay(deal.scheduledDate);
  const [from, to] = slot.split("-");
  const start = wallToCt(deal.scheduledDate, from, zone);
  const end = wallToCt(deal.scheduledEndDate || deal.scheduledDate, to, zone);
  const endDay = end.date !== start.date ? `${cardDay(end.date)} ` : "";
  return `${cardDay(start.date)} ${clock(start.time)} - ${endDay}${clock(end.time)} ${start.abbr}`;
}

const STATUS_WORDS: Record<JobSuperStatus, string> = {
  [JobSuperStatus.SUBMITTED]: "Submitted",
  [JobSuperStatus.IN_PROGRESS]: "In progress",
  [JobSuperStatus.PENDING]: "Pending",
  [JobSuperStatus.DONE_PENDING_APPROVAL]: "done pending approval",
  [JobSuperStatus.DONE]: "Done",
  [JobSuperStatus.CANCELED]: "Canceled",
};

/** The Map's word for a status (its green tags, the Filters' Status list). */
export function mapStatusWord(status: JobSuperStatus): string {
  return STATUS_WORDS[status] ?? status;
}

/**
 * "Thu Oct 08 2026 7:03 pm EDT" — when a tech's last fix came in, on
 * Connecticut's clock and labelled (2026-10-12 owner rule), not the viewer's.
 */
export function lastSeenText(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  // Connecticut's wall clock, read off a UTC date shifted by its offset.
  const wall = new Date(d.getTime() + offsetAt(d.getTime(), DEFAULT_TZ)).toISOString();
  return withZone(`${cardDay(wall.slice(0, 10))} ${wall.slice(0, 4)} ${clock(wall.slice(11, 16))}`, d);
}

/** "Last updated 3:08:12 PM EDT" — the refresh button's tooltip, on Connecticut's clock. */
export function lastUpdatedText(at: number): string {
  const time = new Date(at).toLocaleTimeString("en-US", { timeZone: DEFAULT_TZ });
  return `Last updated ${withZone(time, at)}`;
}
