import type { Deal, TechnicianProfile, TechnicianLocation } from "@bitcrm/types";
import { hasCoords } from "@/lib/geo/geo";

/** A live fix older than this is real but aging — flagged so dispatch knows. */
const STALE_AFTER_MS = 90_000;

/** A deal we know how to plot: its address carries coordinates. */
export type LocatedDeal = Deal & { address: Deal["address"] & { lat: number; lng: number } };

export interface TechnicianPosition {
  userId: string;
  lat: number;
  lng: number;
  /**
   * Where the position came from. "live" is a real GPS fix the technician is
   * sending right now; "home"/"last_job" are inferred. The map says which,
   * because a guess and a measurement shouldn't look the same.
   */
  source: "live" | "home" | "last_job";
  /** For a live fix: its timestamp, and whether it's aging toward expiry. */
  updatedAt?: string;
  stale?: boolean;
  accuracy?: number;
}

/**
 * Deals the map can show, and deals it cannot.
 *
 * The unmapped ones are handed back rather than filtered away: a map that
 * quietly omits a third of the day's work looks complete and is worse than one
 * that admits the gap.
 */
export function splitByLocation(deals: Deal[]): {
  mapped: LocatedDeal[];
  unmapped: Deal[];
} {
  const mapped: LocatedDeal[] = [];
  const unmapped: Deal[] = [];

  for (const deal of deals) {
    if (hasCoords(deal.address)) mapped.push(deal as LocatedDeal);
    else unmapped.push(deal);
  }

  return { mapped, unmapped };
}

/**
 * Where each technician is, derived rather than tracked.
 *
 * The platform has no GPS ingestion and none is planned in this phase, so
 * `phase-1-features.md` defines position as: the address of their last job of
 * the day, or their home address if they have no jobs today. A technician we
 * can place by neither is omitted — a marker at 0,0 would be a fiction.
 *
 * Ordering is by scheduled time slot: `sequenceNumber` exists in the type but
 * nothing in the platform ever writes it.
 */
export function technicianPositions(
  technicians: TechnicianProfile[],
  deals: Deal[],
  today: string,
): TechnicianPosition[] {
  const jobsToday = new Map<string, Deal[]>();

  for (const deal of deals) {
    if (!deal.assignedTechId || deal.scheduledDate !== today) continue;
    const forTech = jobsToday.get(deal.assignedTechId) ?? [];
    forTech.push(deal);
    jobsToday.set(deal.assignedTechId, forTech);
  }

  const positions: TechnicianPosition[] = [];

  for (const tech of technicians) {
    const jobs = (jobsToday.get(tech.userId) ?? [])
      .slice()
      .sort((a, b) => (a.scheduledTimeSlot ?? "").localeCompare(b.scheduledTimeSlot ?? ""));

    const lastJob = jobs.at(-1);

    if (lastJob && hasCoords(lastJob.address)) {
      positions.push({
        userId: tech.userId,
        lat: lastJob.address.lat,
        lng: lastJob.address.lng,
        source: "last_job",
      });
      continue;
    }

    if (hasCoords(tech.homeAddress)) {
      positions.push({
        userId: tech.userId,
        lat: tech.homeAddress.lat,
        lng: tech.homeAddress.lng,
        source: "home",
      });
    }
  }

  return positions;
}

/** Today as the `YYYY-MM-DD` string deals are scheduled with. */
export function todayISO(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Overlay live locations on the derived ones.
 *
 * A live GPS fix is a real measurement, so it wins over the inferred home/last-job
 * position. A technician who is online but has no derived position still appears.
 * Fixes older than the stale threshold are kept (they're the last real position)
 * but flagged, so the dispatcher knows the dot may be behind.
 */
export function mergeLivePositions(
  derived: TechnicianPosition[],
  live: TechnicianLocation[],
  now: number,
  staleAfterMs = STALE_AFTER_MS,
): TechnicianPosition[] {
  const byId = new Map<string, TechnicianPosition>();
  for (const position of derived) byId.set(position.userId, position);

  for (const fix of live) {
    byId.set(fix.userId, {
      userId: fix.userId,
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      updatedAt: fix.updatedAt,
      source: "live",
      stale: now - Date.parse(fix.updatedAt) > staleAfterMs,
    });
  }

  return [...byId.values()];
}
