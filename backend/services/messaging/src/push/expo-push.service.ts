import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { type PushNotificationData } from '@bitcrm/types';
import { INTERNAL_FETCH, defaultFetch, type FetchLike } from '../outbound/internal/internal-fetch';
import { PUSH_CONFIG, type PushConfig } from './push.config';
import { PushDevicesRepository } from './push-devices.repository';

/** Expo accepts at most 100 messages per POST. */
export const EXPO_BATCH_SIZE = 100;

/** One notification, as Expo's API wants it. */
export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: PushNotificationData;
  /** iOS badge; Android ignores it. */
  badge?: number;
  /** `default` plays the standard tone — what a technician expects a job to sound like. */
  sound?: 'default' | null;
  /** `high` wakes the screen on Android; jobs and messages are both time-critical. */
  priority?: 'default' | 'normal' | 'high';
}

/** A ticket Expo answers with, per message, in the order they were sent. */
interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** A receipt, looked up later by ticket id. */
interface ExpoPushReceipt {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/** A ticket that has to be looked up later, with the token it belongs to. */
export interface PendingReceipt {
  id: string;
  token: string;
}

export interface PushSendResult {
  /** True when the feature flag is off: nothing was read, nothing was sent. */
  disabled: boolean;
  accepted: number;
  failed: number;
  /** Tokens Expo rejected outright and that were deleted from the registry. */
  unregistered: string[];
  /** Ticket ids to read receipts for; `collectReceipts` is scheduled for them. */
  pending: PendingReceipt[];
}

/** Expo's word for "this phone is gone" — the one error that must delete a token. */
const DEVICE_NOT_REGISTERED = 'DeviceNotRegistered';

const EMPTY: PushSendResult = { disabled: false, accepted: 0, failed: 0, unregistered: [], pending: [] };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.());

/**
 * The Expo push transport (design: a push is one more channel, not a new
 * system). It knows how to talk to `exp.host` and nothing about jobs or
 * messages — `PushNotifierService` decides who gets what, this sends it:
 *
 *   * batches of at most `EXPO_BATCH_SIZE`, because that is Expo's limit;
 *   * one timeout per attempt, so a hung Expo cannot hold a job event open
 *     until SQS gives up on it;
 *   * retry on 429 and 5xx (and on a network error) with doubling backoff —
 *     never on a 4xx, which will answer the same next time;
 *   * `DeviceNotRegistered`, in a ticket or later in a receipt, deletes that
 *     token from the registry: an uninstalled app is the normal way a token
 *     dies, and left behind it would be pushed to on every job forever.
 *
 * Nothing here needs AWS or a paid account. With `PUSH_ENABLED` unset it is
 * inert: one log line, no registry read, no HTTP call.
 */
@Injectable()
export class ExpoPushService implements OnModuleDestroy {
  private readonly logger = new Logger(ExpoPushService.name);
  private readonly receiptTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    @Inject(PUSH_CONFIG) private readonly config: PushConfig,
    private readonly devices: PushDevicesRepository,
    @Optional() @Inject(INTERNAL_FETCH) private readonly fetchImpl: FetchLike = defaultFetch,
  ) {}

  /** The one question callers ask before doing any work of their own. */
  get enabled(): boolean {
    return this.config.enabled;
  }

  async send(messages: ExpoPushMessage[]): Promise<PushSendResult> {
    if (!this.config.enabled) {
      this.logger.log(`Push is disabled (PUSH_ENABLED): ${messages.length} notification(s) not sent`);
      return { ...EMPTY, disabled: true };
    }
    if (!messages.length) return { ...EMPTY };

    const result: PushSendResult = { ...EMPTY, unregistered: [], pending: [] };
    for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
      const batch = messages.slice(i, i + EXPO_BATCH_SIZE);
      const tickets = await this.postBatch(batch);
      if (!tickets) {
        result.failed += batch.length;
        continue;
      }
      await this.readTickets(batch, tickets, result);
    }

    this.logger.log(
      `Push: ${result.accepted} accepted, ${result.failed} failed, ${result.unregistered.length} token(s) dropped`,
    );
    this.scheduleReceipts(result.pending);
    return result;
  }

  /**
   * Reads the receipts for tickets `send` handed back and drops every token
   * Expo now reports as `DeviceNotRegistered` — the second net under the
   * tickets, because a push can be accepted and only then found undeliverable.
   * Public so it can be driven directly (and tested) rather than only by the
   * timer `send` arms.
   */
  async collectReceipts(pending: PendingReceipt[]): Promise<string[]> {
    if (!this.config.enabled || !pending.length) return [];
    const byId = new Map(pending.map((p) => [p.id, p.token]));
    const dropped: string[] = [];

    for (let i = 0; i < pending.length; i += EXPO_BATCH_SIZE) {
      const ids = pending.slice(i, i + EXPO_BATCH_SIZE).map((p) => p.id);
      const receipts = await this.post<Record<string, ExpoPushReceipt>>(this.config.receiptsUrl, { ids }, 'receipts');
      if (!receipts) continue;
      for (const [id, receipt] of Object.entries(receipts)) {
        if (receipt?.status !== 'error') continue;
        const token = byId.get(id);
        this.logger.warn(`Push receipt ${id} failed: ${receipt.details?.error ?? receipt.message ?? 'unknown'}`);
        if (receipt.details?.error === DEVICE_NOT_REGISTERED && token) {
          await this.drop(token);
          dropped.push(token);
        }
      }
    }
    return dropped;
  }

  onModuleDestroy(): void {
    for (const timer of this.receiptTimers) clearTimeout(timer);
    this.receiptTimers.clear();
  }

  /** Per-message outcomes: accepted, dead token, or a failure worth logging. */
  private async readTickets(
    batch: ExpoPushMessage[],
    tickets: ExpoPushTicket[],
    result: PushSendResult,
  ): Promise<void> {
    for (let i = 0; i < batch.length; i += 1) {
      const ticket = tickets[i];
      const token = batch[i].to;
      // Fewer tickets than messages is Expo misbehaving, not a delivery:
      // count it failed rather than silently treating it as sent.
      if (!ticket) {
        result.failed += 1;
        continue;
      }
      if (ticket.status === 'ok') {
        result.accepted += 1;
        if (ticket.id) result.pending.push({ id: ticket.id, token });
        continue;
      }
      result.failed += 1;
      this.logger.warn(`Push rejected for ${batch[i].data.kind}: ${ticket.details?.error ?? ticket.message ?? 'unknown'}`);
      if (ticket.details?.error === DEVICE_NOT_REGISTERED) {
        await this.drop(token);
        result.unregistered.push(token);
      }
    }
  }

  private async drop(token: string): Promise<void> {
    try {
      await this.devices.remove(token);
      this.logger.log('Dropped a push token Expo reports as no longer registered');
    } catch (error) {
      // A token we failed to delete is one wasted message next time, not a
      // reason to fail the send that discovered it.
      this.logger.warn(`Could not drop a dead push token: ${error instanceof Error ? error.message : error}`);
    }
  }

  private postBatch(batch: ExpoPushMessage[]): Promise<ExpoPushTicket[] | null> {
    return this.post<ExpoPushTicket[]>(this.config.sendUrl, batch, `${batch.length} notification(s)`);
  }

  /**
   * One POST with the retry rules. `null` means "gave up" — the caller
   * counts the batch failed and carries on; a push is never worth failing
   * the job event (or the message send) that produced it.
   */
  private async post<T>(url: string, body: unknown, what: string): Promise<T | null> {
    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt += 1) {
      const last = attempt === this.config.maxAttempts;
      try {
        const res = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            ...(this.config.accessToken ? { authorization: `Bearer ${this.config.accessToken}` } : {}),
          },
          body: JSON.stringify(body),
          signal: this.timeoutSignal(),
        });
        if (res.ok) {
          const payload = (await res.json()) as { data?: T; errors?: Array<{ message?: string }> };
          if (payload?.errors?.length) {
            this.logger.error(`Expo refused ${what}: ${payload.errors.map((e) => e.message).join('; ')}`);
            return null;
          }
          return payload?.data ?? null;
        }
        if (!isRetryable(res.status) || last) {
          this.logger.error(`Expo answered ${res.status} for ${what}${last ? ' (giving up)' : ''}`);
          return null;
        }
        this.logger.warn(`Expo answered ${res.status} for ${what}; retrying (attempt ${attempt})`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (last) {
          this.logger.error(`Push POST for ${what} failed: ${reason} (giving up)`);
          return null;
        }
        this.logger.warn(`Push POST for ${what} failed: ${reason}; retrying (attempt ${attempt})`);
      }
      await sleep(this.config.retryBaseMs * 2 ** (attempt - 1));
    }
    return null;
  }

  /** An `AbortSignal` per attempt, so a hung connection ends at `timeoutMs`. */
  private timeoutSignal(): AbortSignal | undefined {
    if (typeof AbortSignal?.timeout !== 'function') return undefined;
    return AbortSignal.timeout(this.config.timeoutMs);
  }

  /**
   * Expo's receipts are not ready for about 15 minutes, so the lookup is a
   * deferred, unref'd timer rather than a queue: worst case a restart loses
   * the sweep, and the token dies at its next ticket instead.
   */
  private scheduleReceipts(pending: PendingReceipt[]): void {
    if (!pending.length) return;
    const timer = setTimeout(() => {
      this.receiptTimers.delete(timer);
      void this.collectReceipts(pending).catch((error) =>
        this.logger.warn(`Push receipt sweep failed: ${error instanceof Error ? error.message : error}`),
      );
    }, this.config.receiptDelayMs);
    timer.unref?.();
    this.receiptTimers.add(timer);
  }
}

/** Worth another go: Expo is rate-limiting us, or it is having a bad minute. */
function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}
