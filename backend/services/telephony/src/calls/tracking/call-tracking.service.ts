import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import {
  accountWindowUtc,
  CALL_TRACKING_GRAPH_BY,
  CALL_TRACKING_GROUP_BY,
  CALL_TRACKING_MAX_DAYS,
  dashboardDay,
  shiftAccountDay,
  type CallTrackingGraphBy,
  type CallTrackingGroupBy,
  type CallTrackingReport,
} from '@bitcrm/types';
import { CallFlowsService } from '../../call-flows/call-flows.service';
import { NumberSettingsRepository } from '../../numbers/number-settings.repository';
import { DealTotalsClient } from '../../common/deal-totals.client';
import { CallTrackingRepository } from './call-tracking.repository';
import {
  CallTrackingTally,
  serveTracking,
  type CallTrackingSnapshot,
} from './call-tracking';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Bumped when the snapshot's shape or arithmetic changes, so old ones are not served. */
const CACHE_VERSION = 'v1';
/** A window that includes today keeps moving: a short life. */
const LIVE_TTL_SECONDS = 5 * 60;
/** A closed window lives until the next nightly run, with slack. */
const CLOSED_TTL_SECONDS = 26 * 3600;

export interface CallTrackingQuery {
  from?: string;
  to?: string;
  groupBy?: string;
  graphBy?: string;
}

/**
 * Workiz's Call Tracking report: one walk of the call log per window, turned
 * into a snapshot that serves both groupings and every graph step, kept in
 * Redis (5 minutes while the window includes today, until the next night
 * otherwise; `refresh` rebuilds it). Revenue comes from deal-service.
 */
@Injectable()
export class CallTrackingService {
  private readonly logger = new Logger(CallTrackingService.name);
  /** One walk per window at a time — a second viewer waits for the first. */
  private readonly inFlight = new Map<string, Promise<CallTrackingSnapshot>>();

  constructor(
    private readonly repo: CallTrackingRepository,
    @Optional() private readonly deals?: DealTotalsClient,
    @Optional() private readonly callFlows?: CallFlowsService,
    @Optional() private readonly numberSettings?: NumberSettingsRepository,
    @Optional() private readonly redis?: RedisService,
  ) {}

  async report(
    query: CallTrackingQuery,
    opts: { withRevenue: boolean; fresh?: boolean; now?: Date },
  ): Promise<CallTrackingReport> {
    const { from, to } = this.validWindow(query);
    const groupBy = (query.groupBy || 'flows') as CallTrackingGroupBy;
    const graphBy = (query.graphBy || 'hour') as CallTrackingGraphBy;
    if (!CALL_TRACKING_GROUP_BY.includes(groupBy)) {
      throw new BadRequestException(`groupBy is one of ${CALL_TRACKING_GROUP_BY.join(', ')}`);
    }
    if (!CALL_TRACKING_GRAPH_BY.includes(graphBy)) {
      throw new BadRequestException(`graphBy is one of ${CALL_TRACKING_GRAPH_BY.join(', ')}`);
    }
    const snapshot = await this.snapshot(from, to, { fresh: opts.fresh, now: opts.now });
    return serveTracking(snapshot, { groupBy, graphBy, withRevenue: opts.withRevenue });
  }

  /** The snapshot of a window — from Redis unless `fresh`. */
  async snapshot(
    from: string,
    to: string,
    opts: { fresh?: boolean; now?: Date } = {},
  ): Promise<CallTrackingSnapshot> {
    const key = `calls:tracking:${CACHE_VERSION}:${from}:${to}`;
    if (!opts.fresh) {
      const hit = await this.cacheGet(key);
      if (hit) return JSON.parse(hit) as CallTrackingSnapshot;
    }
    const running = this.inFlight.get(key);
    if (running) return running;
    const work = this.build(from, to, key, opts.now ?? new Date()).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, work);
    return work;
  }

  /** The nightly run: this month so far and last month, ending today in New York. */
  async warm(now: Date): Promise<void> {
    const today = dashboardDay(now);
    const firstOfMonth = `${today.slice(0, 7)}-01`;
    const lastMonthEnd = shiftAccountDay(firstOfMonth, -1);
    for (const [from, to] of [
      [firstOfMonth, today],
      [`${lastMonthEnd.slice(0, 7)}-01`, lastMonthEnd],
    ]) {
      await this.snapshot(from, to, { fresh: true, now });
    }
  }

  private async build(from: string, to: string, key: string, now: Date): Promise<CallTrackingSnapshot> {
    const started = Date.now();
    const window = { from, to, ...accountWindowUtc(from, to) };
    const tally = new CallTrackingTally(window);
    const [walk, flowCatalog, numbers] = await Promise.all([
      this.repo.walk(window, (call) => tally.add(call)),
      this.callFlows?.list().catch((err: Error) => this.skip('call flows', err)) ?? [],
      this.numberSettings?.list().catch((err: Error) => this.skip('number settings', err)) ?? [],
    ]);

    let totals = new Map<string, number>();
    let complete = !walk.atLeast;
    const dealIds = tally.dealIds();
    if (dealIds.length && this.deals) {
      try {
        totals = await this.deals.totals(dealIds);
      } catch (err) {
        // Counts are still right; the money is not. Serve it, never keep it.
        this.logger.warn(`Call Tracking ${from}..${to}: job totals unavailable — ${(err as Error).message}`);
        complete = false;
      }
    }

    const snapshot = tally.snapshot({
      totals,
      flowCatalog: (flowCatalog ?? []).map((f) => ({ id: f.id, name: f.name, numbers: f.numbers })),
      numbers: (numbers ?? []).map((n) => ({ phoneNumber: n.phoneNumber, sourceId: n.sourceId })),
      atLeast: walk.atLeast,
      computedAt: now.toISOString(),
    });
    this.logger.log(
      `Call Tracking ${from}..${to}: ${tally.size} calls, ${dealIds.length} jobs, ${walk.queries} queries, ${Date.now() - started}ms`,
    );

    if (complete) {
      const today = dashboardDay(now);
      const ttl = to >= today ? LIVE_TTL_SECONDS : CLOSED_TTL_SECONDS;
      try {
        await this.redis?.client.set(key, JSON.stringify(snapshot), 'EX', ttl);
      } catch (err) {
        this.logger.warn(`Call Tracking snapshot not kept: ${(err as Error).message}`);
      }
    }
    return snapshot;
  }

  /** A cache that is down is a cache miss, not a failed report. */
  private async cacheGet(key: string): Promise<string | null> {
    try {
      return (await this.redis?.client.get(key)) ?? null;
    } catch {
      return null;
    }
  }

  private skip(what: string, err: Error): [] {
    this.logger.warn(`Call Tracking: ${what} unavailable — ${err.message}`);
    return [];
  }

  private validWindow(query: CallTrackingQuery): { from: string; to: string } {
    const { from, to } = query;
    if (!from || !to || !DAY.test(from) || !DAY.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
      throw new BadRequestException('from and to are YYYY-MM-DD days');
    }
    if (to < from) throw new BadRequestException('The window must start on or before it ends');
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
    if (days > CALL_TRACKING_MAX_DAYS) {
      throw new BadRequestException(`The window is limited to ${CALL_TRACKING_MAX_DAYS} days`);
    }
    return { from, to };
  }
}
