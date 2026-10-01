import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { dashboardDay, msUntilDailyAt } from '@bitcrm/types';
import { CallTrackingService } from './call-tracking.service';

const LOCK_PREFIX = 'telephony:lock:tracking-snapshot:';
const LOCK_TTL_SECONDS = 22 * 3600;
/** After the "Top Call Flows" run (one minute after boot) has had its turn. */
const FIRST_RUN_DELAY_MS = 3 * 60_000;

/**
 * Builds Call Tracking's "This month" and "Last month" snapshots every night
 * (the hour of the dashboard snapshots, `DASHBOARD_SNAPSHOT_HOUR`, Eastern;
 * `off` turns it off), so the report opens on a ready answer. A Redis lock on
 * the New York day lets one instance run it.
 */
@Injectable()
export class CallTrackingSnapshotScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CallTrackingSnapshotScheduler.name);
  private timer?: NodeJS.Timeout;
  private readonly hour = Number(process.env.DASHBOARD_SNAPSHOT_HOUR ?? 3);

  constructor(
    private readonly tracking: CallTrackingService,
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

  async runOnce(now: Date = new Date()): Promise<boolean> {
    const key = `${LOCK_PREFIX}${dashboardDay(now)}`;
    const won = await this.redis.client.set(key, `${process.pid}`, 'EX', LOCK_TTL_SECONDS, 'NX');
    if (won !== 'OK') return false;
    try {
      const started = Date.now();
      await this.tracking.warm(now);
      this.logger.log(`Call Tracking snapshots built in ${Date.now() - started}ms`);
      return true;
    } catch (err) {
      await this.redis.client.del(key);
      throw err;
    }
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      void this.runOnce()
        .catch((err: Error) => this.logger.warn(`Call Tracking snapshots failed: ${err.message}`))
        .finally(() => this.schedule(msUntilDailyAt(new Date(), this.hour)));
    }, delayMs);
    this.timer.unref();
  }
}
