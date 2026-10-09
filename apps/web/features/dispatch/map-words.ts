import { JobSuperStatus, type Address, type Deal } from "@bitcrm/types";
import { US_STATES } from "@/features/deals/components/workiz/options";

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

/** "Fri Oct 09 7:30 am - 8:30 am" — the pin card's schedule line. */
export function pinCardWhen(
  deal: Pick<Deal, "scheduledDate" | "scheduledEndDate" | "scheduledTimeSlot" | "allDay">,
): string {
  if (!deal.scheduledDate) return "";
  const day = cardDay(deal.scheduledDate);
  const slot = deal.allDay ? undefined : deal.scheduledTimeSlot;
  if (!slot || !slot.includes("-")) return day;
  const [start, end] = slot.split("-");
  const endDay =
    deal.scheduledEndDate && deal.scheduledEndDate !== deal.scheduledDate ? `${cardDay(deal.scheduledEndDate)} ` : "";
  return `${day} ${clock(start)} - ${endDay}${clock(end)}`;
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

/** "Thu Oct 08 2026 7:03 pm" — when a tech's last fix came in, viewer's time. */
export function lastSeenText(at: string): string {
  const d = new Date(at);
  const hh = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")} ${d.getFullYear()} ${clock(hh)}`;
}
