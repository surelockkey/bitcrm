import { DEFAULT_TZ } from "@/lib/timezone";
import type { CallParty } from "@/features/calls/lib";
import { isClientEndpoint } from "@/features/calls/lib";

/**
 * The day a number was blocked, as Workiz's Blocked callers grid prints it
 * (`2020-07-29`): the business clock's calendar day, never UTC's.
 */
export function blockedDay(iso: string | undefined, tz: string = DEFAULT_TZ): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  // en-CA prints ISO order: YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/**
 * Whether "Block this number" makes sense for a side of a call: an outside
 * number the viewer can see. Never one of our own people (their softphone
 * leg or their phone), never a withheld number, never none at all.
 */
export function canBlockNumber(party: Pick<CallParty, "kind"> & Partial<CallParty>): boolean {
  if (!party.number || party.masked) return false;
  if (party.kind === "user" || isClientEndpoint(party.number)) return false;
  return true;
}
