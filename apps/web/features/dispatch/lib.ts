import { DealStage } from "@bitcrm/types";
import type { Deal, TechnicianProfile, TechnicianLocation } from "@bitcrm/types";
import { hasCoords } from "@/lib/geo/geo";

/** Stages where the technician is actively on the job right now. */
export const ACTIVE_STAGES: ReadonlySet<DealStage> = new Set([
  DealStage.EN_ROUTE,
  DealStage.ON_SITE,
  DealStage.WORK_IN_PROGRESS,
]);

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
 * "just now" / "3 min ago" / "2 h ago" — how long since a fix, for the map + list.
 * Minute granularity, deliberately: seconds would tick on every poll and read as
 * a stopwatch rather than a "last seen" time.
 */
export function formatAge(updatedAt: string | undefined, now: number): string {
  if (!updatedAt) return "";
  const minutes = Math.max(0, Math.floor((now - Date.parse(updatedAt)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export type TechStatus = "live" | "stale" | "derived" | "offline";

/**
 * How a technician reads in the roster list, from their position (if any).
 * "live" = a fresh GPS fix; "stale" = a live fix aging out; "derived" = only the
 * inferred home/last-job spot; "offline" = we can't place them at all.
 */
export function technicianStatus(position?: TechnicianPosition): TechStatus {
  if (!position) return "offline";
  if (position.source !== "live") return "derived";
  return position.stale ? "stale" : "live";
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

/* ----------------------------------------------------------- job status */

/** All of a technician's jobs for `today`, any stage, ordered by time slot. */
export function techJobsToday(deals: Deal[], techId: string, today: string): Deal[] {
  return deals
    .filter((d) => d.assignedTechId === techId && d.scheduledDate === today)
    .sort((a, b) => (a.scheduledTimeSlot ?? "~").localeCompare(b.scheduledTimeSlot ?? "~"));
}

export type TechAvailability = "on_job" | "available" | "offline";

/**
 * The status ring on a technician's marker (story 4.01:83). Derived from work,
 * not a live "busy/lunch" feed the platform doesn't have: an active-stage job →
 * on the job; placeable but idle → available; unplaceable → offline.
 */
export function technicianAvailability(
  jobs: Deal[],
  position: TechnicianPosition | undefined,
): TechAvailability {
  if (!position) return "offline";
  if (jobs.some((d) => ACTIVE_STAGES.has(d.stage))) return "on_job";
  return "available";
}

/**
 * "N of M jobs" for the marker badge (story 4.01:236). M = today's jobs; N =
 * the active job's place in the day, or how many are already done if none is
 * active right now.
 */
export function techJobProgress(jobs: Deal[]): { current: number; total: number } {
  const total = jobs.length;
  const activeIdx = jobs.findIndex((d) => ACTIVE_STAGES.has(d.stage));
  if (activeIdx >= 0) return { current: activeIdx + 1, total };
  const done = jobs.filter((d) => d.stage === DealStage.COMPLETED).length;
  return { current: done, total };
}
