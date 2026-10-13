import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
} from '@nestjs/common';

/** Jobs held (running + waiting) before callers are asked to wait. */
const DEFAULT_MAX_PENDING = 500;
/** How long shutdown waits for queued work. Under SHUTDOWN_GRACE_MS (5 s). */
const DRAIN_DEADLINE_MS = 4_000;
/** Optional DI override of the limit (tests construct with `new`). */
export const WEBHOOK_QUEUE_MAX_PENDING = 'WEBHOOK_QUEUE_MAX_PENDING';

export interface Enqueued {
  /** Settles (never rejects) once this job has run. */
  done: Promise<void>;
  /**
   * True when the queue is over its limit. The caller should then await
   * `done` before answering — the old synchronous behaviour, as backpressure —
   * rather than let the backlog grow without bound.
   */
  overloaded: boolean;
}

/**
 * Per-key serial work queue for Twilio webhooks that answer first and work
 * afterwards (`/voice/conference-events`, `/voice/status`).
 *
 * Jobs with the same key run one at a time in arrival order; different keys
 * run concurrently. A failing job is logged with its label and swallowed — it
 * can't be thrown anywhere useful once the response has gone — and the next
 * job for the key still runs. A key is forgotten as soon as its chain drains,
 * so memory is bounded by the work actually in flight.
 *
 * **Per process.** Twilio delivers each callback to whichever task the ALB
 * picks, so two callbacks for one call that land on different tasks are not
 * ordered by this — exactly as they were not ordered before it (Twilio does
 * not wait for one status callback's response before sending the next). What
 * keeps cross-task interleavings safe is what always did: the monotonic status
 * guard in `CallsService.applyLifecycle`, and the Redis claims (`SET NX`) in
 * ConferenceService. This queue adds ordering within a task; it removes none.
 *
 * Shutdown drains the queue (bounded) before Redis/DynamoDB close: global
 * modules are destroyed last, after this one.
 */
@Injectable()
export class WebhookQueue implements OnModuleDestroy {
  private readonly logger = new Logger(WebhookQueue.name);
  /** The last job's promise per key — the next job chains onto it. */
  private readonly tails = new Map<string, Promise<void>>();
  private pending = 0;
  private idleWaiters: Array<() => void> = [];

  constructor(
    @Optional()
    @Inject(WEBHOOK_QUEUE_MAX_PENDING)
    private readonly maxPending: number = DEFAULT_MAX_PENDING,
  ) {}

  /** Jobs running or waiting. */
  get size(): number {
    return this.pending;
  }

  enqueue(key: string, label: string, job: () => Promise<unknown>): Enqueued {
    const overloaded = this.pending >= this.maxPending;
    this.pending += 1;

    const previous = this.tails.get(key) ?? Promise.resolve();
    const done = previous.then(async () => {
      try {
        await job();
      } catch (error) {
        this.logger.error(
          `Webhook job failed [${label}] key=${key}: ${
            error instanceof Error ? error.stack ?? error.message : String(error)
          }`,
        );
      } finally {
        this.pending -= 1;
        if (this.tails.get(key) === done) this.tails.delete(key);
        if (this.pending === 0) this.notifyIdle();
      }
    });
    this.tails.set(key, done);
    if (overloaded) {
      this.logger.warn(
        `Webhook queue over ${this.maxPending} jobs — [${label}] handled before replying`,
      );
    }
    return { done, overloaded };
  }

  /** Resolves when nothing is queued or running. */
  idle(): Promise<void> {
    if (this.pending === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  async onModuleDestroy(): Promise<void> {
    await this.drain(DRAIN_DEADLINE_MS);
  }

  private async drain(deadlineMs: number): Promise<void> {
    if (this.pending === 0) return;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), deadlineMs);
      timer.unref?.();
    });
    const result = await Promise.race([this.idle(), timeout]);
    if (timer) clearTimeout(timer);
    if (result === 'timeout') {
      this.logger.warn(`Shutdown with ${this.pending} webhook job(s) still pending`);
    }
  }

  private notifyIdle(): void {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    waiters.forEach((resolve) => resolve());
  }
}
