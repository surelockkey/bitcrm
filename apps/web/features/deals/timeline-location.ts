/**
 * Where the technician's phone was when they changed a job's status or said
 * they arrived (owner, 2026-10-15). The deal service writes it on the
 * timeline entry's `details` (`backend/services/deal/src/deals/location-details.ts`):
 *
 * - `location` — `{ lat, lng, accuracy? }`, the phone's fix;
 * - `distanceM` — whole metres from the job's address, absent when the
 *   address has no coordinates;
 * - `farFromAddress` — more than 500 m away: the office sees it in red.
 *
 * A change made on the web carries none of them.
 */

export interface TimelineLocationNote {
  /** "120 m from the address", "14.2 km from the address", "location recorded". */
  text: string;
  far: boolean;
}

const KM = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** "120 m" under a kilometre, "14.2 km" from one on. */
export function formatDistance(metres: number): string {
  const whole = Math.round(metres);
  return whole < 1000 ? `${whole} m` : `${KM.format(metres / 1000)} km`;
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** What a status change or an arrival says about where it happened; `null` when the phone sent no fix. */
export function timelineLocationNote(details: Record<string, unknown> | undefined): TimelineLocationNote | null {
  const fix = details?.location as { lat?: unknown; lng?: unknown } | null | undefined;
  if (!fix || typeof fix !== "object" || !isNumber(fix.lat) || !isNumber(fix.lng)) return null;
  const distance = details?.distanceM;
  if (!isNumber(distance) || distance < 0) return { text: "location recorded", far: false };
  return { text: `${formatDistance(distance)} from the address`, far: details?.farFromAddress === true };
}
