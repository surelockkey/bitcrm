import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DealReadService, type DealForMessaging } from '../api/access/deal-read.service';
import {
  agreesWith,
  jobPartiesOf,
  mergeEventDeal,
  renameContact,
  scopeDealsOf,
  type TechScopeParty,
} from './tech-scope.logic';
import { TechScopeRepository, type TechScopeRow } from './tech-scope.repository';

/** A stored row older than this is still served, and rebuilt in the background. */
export const TECH_SCOPE_MAX_AGE_MS = 15 * 60_000;
/** A gate that said "not ready" is asked again after this long. */
const READY_RECHECK_MS = 60_000;
/** deal-service's by-tech answers at most this many jobs; a row with this many may have been cut. */
export const BY_TECH_LIMIT = 100;
/** Technicians recomputed side by side for one job event. */
const EVENT_CONCURRENCY = 3;

/** Injection token for the clock — tests only. */
export const TECH_SCOPE_CLOCK = Symbol('TECH_SCOPE_CLOCK');

export interface TechScopeRebuildStats {
  users: number;
  /** Rows written (new or changed). */
  written: number;
  /** Rows already exactly right. */
  unchanged: number;
  /** Users with no job and no row — nothing to store. */
  skipped: number;
  /** Rows of users that no longer exist, removed. */
  removed: number;
  /** Users deal-service could not answer for — the gate is not stamped while any. */
  failed: number;
  stateStamped: boolean;
}

/**
 * The technician inbox (Phase C, C4). An `assigned_only` caller's inbox is
 * the threads of the clients on their jobs plus their own team thread and
 * groups. The jobs half used to cost a deal-service call per request (and
 * then one pointer + one conversation read per party, 25 at a time); it is
 * now stored per technician (`TechScopeRepository`) and read by key.
 *
 * Visibility is derived by the SAME functions as the live path
 * (`tech-scope.logic.ts`) from the SAME source — deal-service's by-tech
 * answer — so a row is exactly what the live path would compute at the
 * moment the row was built. It is kept current by:
 *
 *   - every job event (`deal-events-to-messaging`): the job is re-read fresh
 *     and every technician on it — plus the one an unassign names — is
 *     recomputed from a fresh by-tech read, with the job itself laid over it
 *     (TechIndex is a GSI and may lag the event); skipped when the row
 *     already agrees and cannot have been cut at 100;
 *   - `contact.merged`: the duplicate's id is renamed to the survivor's in
 *     every row that holds it (deal-service re-points those jobs without a
 *     job event);
 *   - reads: a missing row is computed (live) and stored; a row older than
 *     `TECH_SCOPE_MAX_AGE_MS` is served and rebuilt in the background — the
 *     bound on any drift from a lost event.
 *
 * What a row does NOT hold, because it needs no projection: conversations,
 * pointers and group membership. Those are messaging's own rows and are read
 * live on every request (one BatchGet each), so a conversation created,
 * re-linked or messaged needs no maintenance here.
 *
 * Gate: until `backfill:tech-scope -- --apply` has stamped
 * `TECHSCOPEINDEX / STATE`, reads take the live path; the rows are
 * maintained from deploy time on regardless.
 *
 * Failure: a recompute deal-service cannot answer DELETES the row (never
 * leaves a stale one in place) — the next read then takes the live path,
 * whose outage behaviour (the caller's own threads only) is today's.
 */
@Injectable()
export class TechScopeService {
  private readonly logger = new Logger(TechScopeService.name);
  private ready = false;
  private readyCheckedAt = 0;
  private readyFlight: Promise<boolean> | null = null;
  private readonly refreshing = new Map<string, Promise<void>>();
  private readonly now: () => number;

  constructor(
    private readonly repo: TechScopeRepository,
    private readonly deals: DealReadService,
    @Optional() @Inject(TECH_SCOPE_CLOCK) now?: () => number,
  ) {
    this.now = now ?? Date.now;
  }

  // ------------------------------------------------------------------ reads

  /** The parties whose threads the technician's jobs open, in the live path's order. */
  async jobParties(userId: string): Promise<TechScopeParty[]> {
    if (!(await this.isReady())) return this.liveParties(userId);

    let row: TechScopeRow | null;
    try {
      row = await this.repo.get(userId);
    } catch (err) {
      this.logger.warn(`tech scope ${userId}: row unreadable, live path: ${(err as Error).message}`);
      return this.liveParties(userId);
    }

    if (!row) {
      // First read since the gate opened (a new technician, or a row an
      // outage dropped): compute it as the live path would, and keep it.
      const built = await this.compute(userId);
      if (!built) return [];
      await this.store(built);
      return jobPartiesOf(built.deals);
    }

    if (this.now() - Date.parse(row.computedAt) > TECH_SCOPE_MAX_AGE_MS) this.refreshInBackground(userId);
    return jobPartiesOf(row.deals);
  }

  /** Today's path: deal-service on the request (its 60 s cache), nothing stored. */
  async liveParties(userId: string): Promise<TechScopeParty[]> {
    const deals = (await this.deals.listByTech(userId)) ?? [];
    return jobPartiesOf(scopeDealsOf(deals, userId));
  }

  /** `TECHSCOPEINDEX / STATE` exists. Once seen it stays true for the process; "no" is re-asked each minute. */
  async isReady(): Promise<boolean> {
    if (this.ready) return true;
    if (this.now() - this.readyCheckedAt < READY_RECHECK_MS) return false;
    if (!this.readyFlight) {
      this.readyFlight = this.repo
        .getState()
        .then((state) => {
          this.ready = !!state;
          return this.ready;
        })
        .catch((err: Error) => {
          this.logger.warn(`tech scope gate unreadable: ${err.message}`);
          return false;
        })
        .finally(() => {
          this.readyCheckedAt = this.now();
          this.readyFlight = null;
        });
    }
    return this.readyFlight;
  }

  // --------------------------------------------------------------- maintain

  /**
   * A job event: recompute every technician on the job, and those named by
   * the event (`deal.tech_unassigned` names one no longer on it). Never
   * throws — the automations share the queue message.
   */
  async onDealEvent(dealId: string, alsoTechIds: string[] = []): Promise<void> {
    try {
      const fresh = await this.deals.find(dealId, { fresh: true });
      const candidates = [...new Set([...(fresh?.assignedTechIds ?? []), ...alsoTechIds.filter(Boolean)])];
      await pool(candidates, EVENT_CONCURRENCY, (techId) => this.applyDeal(techId, fresh));
    } catch (err) {
      this.logger.warn(`tech scope: job ${dealId} event not applied: ${(err as Error).message}`);
    }
  }

  /** `contact.merged`: the duplicate's id becomes the survivor's in every row that holds it. Never throws. */
  async onContactMerged(fromContactId: string, toContactId: string): Promise<void> {
    if (!fromContactId || !toContactId || fromContactId === toContactId) return;
    try {
      for (const row of await this.repo.listByContact(fromContactId)) {
        const written = await this.repo.put(
          { ...row, deals: renameContact(row.deals, fromContactId, toContactId) },
          { expectComputedAt: row.computedAt },
        );
        // Raced by a recompute: that one is newer, but may predate deal-service's
        // own re-pointing — drop it so the next read rebuilds.
        if (!written) await this.drop(row.userId);
      }
    } catch (err) {
      this.logger.warn(`tech scope: merge ${fromContactId} → ${toContactId} not applied: ${(err as Error).message}`);
    }
  }

  /**
   * The reconciling backfill (`backfill:tech-scope`): recompute the row of
   * every user (`userIds` — user-service's list) and of every row that
   * exists; rows of users no longer listed are removed. Stamps the gate only
   * on `apply` with no failure.
   */
  async rebuild(userIds: string[], opts: { apply: boolean; concurrency?: number }): Promise<TechScopeRebuildStats> {
    const known = new Set(userIds.filter(Boolean));
    const existing = new Map((await this.repo.listAll()).map((r) => [r.userId, r]));
    const targets = [...new Set([...known, ...existing.keys()])];
    const stats: TechScopeRebuildStats = {
      users: known.size,
      written: 0,
      unchanged: 0,
      skipped: 0,
      removed: 0,
      failed: 0,
      stateStamped: false,
    };

    await pool(targets, opts.concurrency ?? 4, async (userId) => {
      try {
        if (!known.has(userId)) {
          stats.removed++;
          if (opts.apply) await this.repo.delete(userId);
          return;
        }
        const built = await this.compute(userId);
        if (!built) {
          stats.failed++;
          return;
        }
        const had = existing.get(userId);
        if (!had && built.deals.length === 0) {
          stats.skipped++;
          return;
        }
        if (had && had.dealCount === built.dealCount && JSON.stringify(had.deals) === JSON.stringify(built.deals)) {
          stats.unchanged++;
          return;
        }
        stats.written++;
        if (opts.apply) await this.repo.put(built);
      } catch (err) {
        stats.failed++;
        this.logger.warn(`tech scope rebuild ${userId}: ${(err as Error).message}`);
      }
    });

    if (opts.apply && stats.failed === 0) {
      await this.repo.putState({
        readyAt: new Date(this.now()).toISOString(),
        count: stats.written + stats.unchanged,
      });
      this.ready = true;
      stats.stateStamped = true;
    }
    return stats;
  }

  // -------------------------------------------------------------- internals

  private async applyDeal(techId: string, fresh: DealForMessaging | null): Promise<void> {
    try {
      if (fresh) {
        const row = await this.repo.get(techId);
        // Already right about this job, and not cut at 100 (where a move of
        // the job could pull another one in or out): nothing to do.
        if (row && row.dealCount < BY_TECH_LIMIT && agreesWith(row.deals, fresh, techId)) return;
      }
      const built = await this.compute(techId, fresh);
      if (!built) return this.drop(techId);
      await this.repo.put(built);
    } catch (err) {
      this.logger.warn(`tech scope ${techId}: recompute failed, row dropped: ${(err as Error).message}`);
      await this.drop(techId);
    }
  }

  /** The row as of now, from a fresh by-tech read; `null` when deal-service cannot answer. */
  private async compute(userId: string, fresh: DealForMessaging | null = null): Promise<TechScopeRow | null> {
    const computedAt = new Date(this.now()).toISOString();
    const list = await this.deals.listByTech(userId, { fresh: true });
    if (list === null) return null;
    return {
      userId,
      deals: mergeEventDeal(scopeDealsOf(list, userId), fresh, userId),
      computedAt,
      dealCount: list.length,
    };
  }

  /** A write from the read path must never fail the request. */
  private async store(row: TechScopeRow): Promise<void> {
    try {
      await this.repo.put(row);
    } catch (err) {
      this.logger.warn(`tech scope ${row.userId}: row not stored: ${(err as Error).message}`);
    }
  }

  private refreshInBackground(userId: string): void {
    if (this.refreshing.has(userId)) return;
    const run = (async () => {
      const built = await this.compute(userId);
      if (built) await this.repo.put(built);
    })()
      .catch((err: Error) => this.logger.warn(`tech scope ${userId}: background refresh failed: ${err.message}`))
      .finally(() => this.refreshing.delete(userId));
    this.refreshing.set(userId, run);
  }

  /** Test hook: wait for the background refreshes started so far. */
  async settled(): Promise<void> {
    await Promise.all([...this.refreshing.values()]);
  }

  private async drop(userId: string): Promise<void> {
    try {
      await this.repo.delete(userId);
    } catch (err) {
      this.logger.warn(`tech scope ${userId}: row not dropped: ${(err as Error).message}`);
    }
  }
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await work(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}
