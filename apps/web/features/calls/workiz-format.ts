import { ordinal } from "@/components/workiz/dates";
import { DEFAULT_TZ } from "@/lib/timezone";

/**
 * The call log's Time column, word for word as Workiz prints it
 * (`/node-voice/calls/report/` → `created`, `call_duration`).
 */

const parts = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = parts.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    parts.set(timeZone, f);
  }
  return f;
}

/**
 * "Thu Oct 8th, 3:15PM": the start on the account's clock, no year (Workiz
 * never adds one). A missing or broken instant is blank.
 *
 * Workiz's live-updated rows print the hour padded ("03:15PM"); the rows its
 * server sends — every row on a fresh load — do not, and that is the form kept.
 */
export function formatWzCallTime(iso: string | undefined, timeZone: string = DEFAULT_TZ): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const p: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(at)) p[part.type] = part.value;
  return `${p.weekday} ${p.month} ${ordinal(Number(p.day))}, ${p.hour}:${p.minute}${p.dayPeriod}`;
}

/**
 * "4 Min 21 Sec", "0 Sec", "130 Min 42 Sec" — minutes never roll into hours
 * (Workiz's own `call_duration`). Nothing, negatives and junk read as no time.
 */
export function formatWzCallDuration(seconds: number | undefined): string {
  const s = typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const min = Math.floor(s / 60);
  return min > 0 ? `${min} Min ${s % 60} Sec` : `${s} Sec`;
}
