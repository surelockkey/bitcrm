import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { InvoicesService } from './invoices.service';

const LOCK_KEY = 'billing:lock:overdue-sweep';
const FIRST_RUN_DELAY_MS = 60_000;

/**
 * Re-derives `due` → `overdue` periodically. Every instance schedules it;
 * a Redis `SET NX EX` lock lets one of them run it per period.
 * `BILLING_OVERDUE_SWEEP_HOURS=0` turns it off.
 */
@Injectable()
export class OverdueSweepScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OverdueSweepScheduler.name);
  private timers: NodeJS.Timeout[] = [];
  private readonly periodHours = Number(process.env.BILLING_OVERDUE_SWEEP_HOURS ?? 24);

  constructor(
    private readonly invoices: InvoicesService,
    private readonly redis: RedisService,
  ) {}

  onApplicationBootstrap(): void {
    if (!(this.periodHours > 0) || process.env.NODE_ENV === 'test') return;
    const periodMs = this.periodHours * 3_600_000;
    const run = () => void this.runOnce().catch((err: Error) => this.logger.warn(`overdue sweep failed: ${err.message}`));
    const first = setTimeout(run, FIRST_RUN_DELAY_MS);
    const every = setInterval(run, periodMs);
    first.unref();
    every.unref();
    this.timers = [first, every];
  }

  onApplicationShutdown(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  /** Runs the sweep if this instance wins the lock; `null` when it didn't. */
  async runOnce(): Promise<number | null> {
    const ttlSeconds = Math.max(60, Math.floor(Math.max(this.periodHours, 1) * 3600) - 60);
    const won = await this.redis.client.set(LOCK_KEY, `${process.pid}`, 'EX', ttlSeconds, 'NX');
    if (won !== 'OK') return null;
    const changed = await this.invoices.sweepOverdue();
    if (changed) this.logger.log(`overdue sweep: ${changed} invoice(s) now overdue`);
    return changed;
  }
}
