import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { dashboardDay, msUntilDailyAt } from '@bitcrm/types';
import { CallsService } from './calls.service';

const LOCK_PREFIX = 'telephony:lock:flow-snapshot:';
/** Held for the day it names, so a second instance or a restart does not redo it. */
const LOCK_TTL_SECONDS = 22 * 3600;
/** Long enough for the service to settle after a deploy before it reads a quarter of jobs. */
const FIRST_RUN_DELAY_MS = 60_000;

/**
 * Builds the dashboard's "Top Call Flows" snapshots every night at 3 AM
 * Eastern, alongside deal-service's for the job widgets, so opening the
 * dashboard reads them instead of walking the call log.
 *
 * Every instance schedules it; a Redis `SET NX` on the New York day lets one
 * of them run it, and the same lock runs it once after boot when today has no
 * snapshots yet. `DASHBOARD_SNAPSHOT_HOUR` moves the hour; `off` turns it off.
 */
@Injectable()
export class FlowSnapshotScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(FlowSnapshotScheduler.name);
  private timer?: NodeJS.Timeout;
  private readonly hour = Number(process.env.DASHBOARD_SNAPSHOT_HOUR ?? 3);

  constructor(
    private readonly calls: CallsService,
    private readonly redis: RedisService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test' || !(this.hour >= 0 && this.hour < 24)) return;
    this.schedule(FIRST_RUN_DELAY_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Milliseconds until the next run: the next `hour`:00 in New York. */
  delayFrom(now: Date): number {
    return msUntilDailyAt(now, this.hour);
  }

  /** Warms if this instance wins today's lock; `false` when another already has. */
  async runOnce(now: Date = new Date()): Promise<boolean> {
    const key = `${LOCK_PREFIX}${dashboardDay(now)}`;
    const won = await this.redis.client.set(key, `${process.pid}`, 'EX', LOCK_TTL_SECONDS, 'NX');
    if (won !== 'OK') return false;
    try {
      const started = Date.now();
      await this.calls.warmFlows(now);
      this.logger.log(`"Top Call Flows" snapshots built in ${Date.now() - started}ms`);
      return true;
    } catch (err) {
      // Hand the day back: a failure at 3 AM must not leave the dashboard on
      // yesterday's numbers until tomorrow night.
      await this.redis.client.del(key);
      throw err;
    }
  }

  // A chain of timeouts rather than an interval: each run re-reads the clock,
  // so the hour holds across the spring and autumn clock changes.
  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      void this.runOnce()
        .catch((err: Error) => this.logger.warn(`"Top Call Flows" snapshots failed: ${err.message}`))
        .finally(() => this.schedule(this.delayFrom(new Date())));
    }, delayMs);
    this.timer.unref();
  }
}
