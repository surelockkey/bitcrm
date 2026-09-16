import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MESSAGE_STATUS_RANK } from '@bitcrm/types';
import { PendingStatusTracker, type PendingStatusEntry } from '../messages/pending-status.tracker';
import { RECONCILE_CONFIG, type ReconcileConfig } from './reconcile.config';
import { ReconcileService, type MessageSyncResult } from './reconcile.service';

/** A line younger than this is left to the status callback, which normally lands within seconds. */
export const STATUS_SYNC_MIN_AGE_MS = 60_000;
/** A line still not terminal after this long is forgotten — the carrier will not report anything else. */
export const STATUS_SYNC_MAX_AGE_MS = 24 * 60 * 60_000;
/** Ceiling of the back-off between two checks of the same line. */
export const STATUS_SYNC_MAX_BACKOFF_MS = 60 * 60_000;

/** What one pass did. */
export interface StatusSyncPass {
  /** Lines asked about at Twilio. */
  checked: number;
  /** Lines whose status moved. */
  synced: number;
  /** Lines removed from the set (terminal now, gone, or too old — a day, whether the lookup answered or threw). */
  dropped: number;
  /** Lookups that threw (kept in the set and retried after the back-off, unless the line is a day old). */
  failed: number;
}

/**
 * The opt-in poller behind `MESSAGING_STATUS_SYNC_INTERVAL_SECONDS` (0 =
 * off): every interval, the outbound lines this process handed to Twilio
 * (`PendingStatusTracker`, fed by `OutboundWorker`) that are at least 60 s
 * old and still short of a terminal status are looked up one by one
 * through `ReconcileService.syncMessage`. It exists for the cases the
 * status callback cannot cover — a developer machine without a public
 * `PUBLIC_BASE_URL`, or a callback Twilio gave up retrying — and is not the
 * primary path: the callback still wins whenever it arrives, and the
 * hourly reconciliation covers lines other instances sent.
 *
 * A line the carrier never reports on (stuck at `sent`) is retried with a
 * doubling back-off capped at an hour and forgotten after a day — as is one
 * whose lookup keeps throwing, so a bad sid cannot stay in the set for good.
 */
@Injectable()
export class StatusSyncPoller implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StatusSyncPoller.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly reconcile: ReconcileService,
    private readonly pending: PendingStatusTracker,
    @Inject(RECONCILE_CONFIG) private readonly config: Pick<ReconcileConfig, 'statusSyncIntervalSeconds'>,
  ) {}

  get enabled(): boolean {
    return this.config.statusSyncIntervalSeconds > 0;
  }

  get intervalMs(): number {
    return this.config.statusSyncIntervalSeconds * 1000;
  }

  onModuleInit(): void {
    if (!this.enabled || this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
    this.logger.log(
      `Status sync poller on: every ${this.config.statusSyncIntervalSeconds}s, outbound lines older than ${STATUS_SYNC_MIN_AGE_MS / 1000}s without a terminal status are looked up at Twilio`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One pass over the due lines. Overlapping passes are skipped; a failing lookup never stops the pass. */
  async tick(now: Date = new Date()): Promise<StatusSyncPass> {
    const pass: StatusSyncPass = { checked: 0, synced: 0, dropped: 0, failed: 0 };
    if (this.running) return pass;
    this.running = true;
    try {
      const t = now.getTime();
      for (const entry of this.pending.due(t, STATUS_SYNC_MIN_AGE_MS)) {
        pass.checked++;
        let result: MessageSyncResult;
        try {
          result = await this.reconcile.syncMessage(entry.key, now);
        } catch (error) {
          pass.failed++;
          this.logger.warn(`Status sync of ${entry.key.messageId} failed: ${error instanceof Error ? error.message : error}`);
          // The day's ceiling holds here too: a lookup that keeps throwing does not keep the line forever.
          if (this.expired(entry, t)) {
            this.pending.forget(entry.key);
            pass.dropped++;
          } else {
            this.pending.defer(entry.key, t + this.backoff(entry));
          }
          continue;
        }
        if (result.outcome === 'synced') pass.synced++;
        if (this.settled(result, entry, t)) {
          this.pending.forget(entry.key);
          pass.dropped++;
        } else {
          this.pending.defer(entry.key, t + this.backoff(entry));
        }
      }
    } finally {
      this.running = false;
    }
    if (pass.checked) this.logger.log(`Status sync pass: ${pass.checked} checked, ${pass.synced} synced, ${pass.dropped} dropped, ${pass.failed} failed`);
    return pass;
  }

  /** Nothing more will come for this line: terminal now, not ours to follow, or too old. */
  private settled(result: MessageSyncResult, entry: PendingStatusEntry, now: number): boolean {
    if (result.outcome === 'not_found' || result.outcome === 'not_syncable') return true;
    if (result.message && MESSAGE_STATUS_RANK[result.message.status] >= MESSAGE_STATUS_RANK.delivered) return true;
    return this.expired(entry, now);
  }

  /** Past the day's ceiling: the carrier will not report anything else, and neither will a retry. */
  private expired(entry: PendingStatusEntry, now: number): boolean {
    return now - entry.trackedAt > STATUS_SYNC_MAX_AGE_MS;
  }

  /** interval × 2^attempts, capped — `attempts` counts the checks already made. */
  private backoff(entry: PendingStatusEntry): number {
    const base = Math.max(this.intervalMs, 1000);
    return Math.min(base * 2 ** entry.attempts, STATUS_SYNC_MAX_BACKOFF_MS);
  }
}
