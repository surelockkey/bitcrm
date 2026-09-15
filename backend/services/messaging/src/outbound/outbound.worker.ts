import { Inject, Injectable, Logger } from '@nestjs/common';
import { TWILIO_CONFIG, TwilioRest, type TwilioConfig } from '@bitcrm/shared';
import {
  MESSAGE_STATUS_RANK,
  isSmsChannel,
  isTerminalMessageStatus,
  type Message,
  type MessageStatus,
} from '@bitcrm/types';
import { MessagesRepository, type MessageKey } from '../messages/messages.repository';
import { OptOutsRepository } from '../opt-outs/opt-outs.repository';
import { OutboundEventsPublisher } from './outbound-events';
import { type OutboundJob } from './outbound-queue.producer';
import { OutboundRepository } from './outbound.repository';
import { OUTBOUND_CONFIG, type OutboundConfig } from './outbound.config';
import {
  OPT_OUT_ERROR_CODE,
  classifyTwilioError,
  describeTwilioError,
  mapTwilioStatus,
} from './twilio-error.map';

/** The slice of a Twilio `MessageInstance` the worker reads. */
export interface TwilioMessageResult {
  sid: string;
  status: string;
  numSegments?: string | null;
  from?: string | null;
  to?: string | null;
  body?: string | null;
  direction?: string | null;
  errorCode?: number | null;
  errorMessage?: string | null;
  dateCreated?: Date | null;
}

export interface TwilioCreateParams {
  messagingServiceSid?: string;
  from?: string;
  to: string;
  body?: string;
  mediaUrl?: string[];
  statusCallback?: string;
}

/** `client.messages`, narrowed so tests hand in a fake without the SDK types. */
export interface TwilioMessagesApi {
  create(params: TwilioCreateParams): Promise<TwilioMessageResult>;
  list(params: { to?: string; from?: string; limit?: number }): Promise<TwilioMessageResult[]>;
}

/** How far back the reconciliation looks for a message a dead attempt may have sent (§4.4). */
export const RECONCILE_WINDOW_MS = 60_000;

const isJob = (p: unknown): p is OutboundJob =>
  !!p &&
  typeof p === 'object' &&
  typeof (p as OutboundJob).conversationId === 'string' &&
  typeof (p as OutboundJob).createdAt === 'string' &&
  typeof (p as OutboundJob).messageId === 'string';

/**
 * The send half of outbound SMS (design §4.4 step 4): one job = one
 * `queued` message. Claim it (`markSending`), call `messages.create`
 * through the Messaging Service with the resolved `From` and our status
 * callback, record the sid, and let the callback walk the status.
 *
 * Idempotency, because Twilio's Messages API has no idempotency key and
 * SQS redelivers: a claim that fails on a message that already carries
 * `sendingStartedAt` means a previous attempt died mid-call, so the
 * account's recent messages to that number are searched for the same body
 * before sending again. Transient failures (429 / 5xx / network) throw so
 * SQS retries and the DLQ catches the fifth; stable ones mark the message
 * `failed` with the code, and 21610 also puts the recipient on the STOP list.
 */
@Injectable()
export class OutboundWorker {
  private readonly logger = new Logger(OutboundWorker.name);

  constructor(
    private readonly messages: MessagesRepository,
    private readonly outbound: OutboundRepository,
    private readonly optOuts: OptOutsRepository,
    private readonly events: OutboundEventsPublisher,
    private readonly rest: TwilioRest,
    @Inject(TWILIO_CONFIG) private readonly twilio: Pick<TwilioConfig, 'messagingServiceSid' | 'publicBaseUrl'>,
    @Inject(OUTBOUND_CONFIG) private readonly config: Pick<OutboundConfig, 'mediaUrlTtlSeconds'>,
  ) {}

  /** The SQS handler (`eventType: message.send`). A malformed payload is dropped, not retried. */
  async handle(payload: unknown): Promise<void> {
    if (!isJob(payload)) {
      this.logger.warn(`Dropping malformed outbound job: ${JSON.stringify(payload)}`);
      return;
    }
    await this.process(payload);
  }

  async process(job: OutboundJob): Promise<void> {
    const message = await this.messages.get(job);
    if (!message) {
      this.logger.warn(`Outbound job for missing message ${job.messageId}; dropping`);
      return;
    }
    if (message.direction !== 'outbound' || !isSmsChannel(message.channel) || !message.to) {
      this.logger.warn(`Message ${message.id} is not a deliverable outbound SMS; dropping`);
      return;
    }
    if (message.providerSid) {
      // Already at Twilio (a redelivery after success): make sure the pointer exists and stop.
      await this.messages.putProviderSidPointer(message.providerSid, job);
      return;
    }
    if (message.status !== 'queued' && message.status !== 'sending') return;

    const claimed = await this.messages.markSending(job);
    if (!claimed) {
      if (!message.sendingStartedAt) return; // another worker holds the claim
      const earlier = await this.reconcile(message);
      if (earlier) {
        this.logger.log(`Reconciled ${message.id} to ${earlier.sid} sent by an earlier attempt`);
        await this.accepted(message, job, earlier);
        return;
      }
    }

    let result: TwilioMessageResult;
    try {
      result = await this.api().create(await this.params(message, job));
    } catch (error) {
      await this.failedOrRetry(message, job, error);
      return;
    }
    await this.accepted(message, job, result);
  }

  // ------------------------------------------------------------ internals

  private api(): TwilioMessagesApi {
    return this.rest.client.messages as unknown as TwilioMessagesApi;
  }

  private async params(message: Message, job: MessageKey): Promise<TwilioCreateParams> {
    const media = await this.mediaUrls(message);
    // Only the keys that carry a value: `from` absent means "the pool picks".
    return {
      ...(this.twilio.messagingServiceSid ? { messagingServiceSid: this.twilio.messagingServiceSid } : {}),
      ...(message.from ? { from: message.from } : {}),
      to: message.to!,
      ...(message.body ? { body: message.body } : {}),
      ...(media.length ? { mediaUrl: media } : {}),
      ...(this.twilio.publicBaseUrl ? { statusCallback: this.statusCallbackUrl(job) } : {}),
    };
  }

  /** TODO(M10b): presigned GET URLs for `attachments[].s3Key`, `mediaUrlTtlSeconds` long. */
  protected async mediaUrls(_message: Message): Promise<string[]> {
    return [];
  }

  /** `…/webhooks/twilio/status?c&t&m` — the key rides in the query, which the signature covers (§4.5). */
  statusCallbackUrl(job: MessageKey): string {
    const q = new URLSearchParams({ c: job.conversationId, t: job.createdAt, m: job.messageId });
    return `${this.twilio.publicBaseUrl}/api/messaging/webhooks/twilio/status?${q.toString()}`;
  }

  /**
   * Did the attempt that died after `sendingStartedAt` reach Twilio? The
   * account's latest messages to this number are listed (no `DateSent`
   * filter: a message still queued at Twilio has none) and matched on body
   * and creation time inside the window. Best-effort — a listing failure
   * means "not found", and the message is sent again.
   */
  private async reconcile(message: Message): Promise<TwilioMessageResult | null> {
    const since = new Date(message.sendingStartedAt!).getTime() - RECONCILE_WINDOW_MS;
    try {
      const recent = await this.api().list({ to: message.to, from: message.from || undefined, limit: 20 });
      return (
        recent.find((m) => {
          const created = m.dateCreated ? new Date(m.dateCreated).getTime() : Number.POSITIVE_INFINITY;
          const outbound = !m.direction || m.direction.startsWith('outbound');
          return outbound && created >= since && (m.body ?? '') === (message.body ?? '');
        }) ?? null
      );
    } catch (error) {
      this.logger.warn(`reconciliation listing failed for ${message.id}: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  private async accepted(message: Message, job: MessageKey, result: TwilioMessageResult): Promise<void> {
    const segments = Number(result.numSegments);
    const pointerNew = await this.messages.putProviderSidPointer(result.sid, job);
    await this.outbound.attachProviderSid(job, {
      providerSid: result.sid,
      segments: Number.isFinite(segments) && segments > 0 ? segments : undefined,
      from: result.from ?? undefined,
    });

    const mapped = mapTwilioStatus(result.status);
    if (mapped && MESSAGE_STATUS_RANK[mapped] > MESSAGE_STATUS_RANK.sending) {
      const errorCode = result.errorCode ? String(result.errorCode) : undefined;
      await this.applyStatus(message, job, mapped, result.sid, errorCode, result.errorMessage);
    }

    if (pointerNew) {
      this.logger.log(`Sent ${message.id} as ${result.sid} (${result.status})`);
      void this.events.messageSent({ ...message, businessNumber: message.businessNumber ?? result.from ?? undefined }, result.sid);
    }
    void this.events.conversationUpdated(message.conversationId);
  }

  private async failedOrRetry(message: Message, job: MessageKey, error: unknown): Promise<void> {
    const action = classifyTwilioError(error);
    if (action.kind === 'retry') {
      this.logger.warn(`Twilio create failed for ${message.id}, will retry: ${action.reason}`);
      throw error;
    }
    this.logger.warn(`Twilio refused ${message.id}: ${action.errorCode} ${action.errorMessage}`);
    await this.applyStatus(message, job, 'failed', undefined, action.errorCode, action.errorMessage);
    void this.events.conversationUpdated(message.conversationId);
  }

  private async applyStatus(
    message: Message,
    job: MessageKey,
    status: MessageStatus,
    providerSid: string | undefined,
    errorCode: string | undefined,
    errorMessage: string | null | undefined,
  ): Promise<void> {
    const applied = await this.messages.updateStatus(job, {
      status,
      providerSid,
      errorCode,
      errorMessage: errorCode ? describeTwilioError(errorCode, errorMessage) : undefined,
    });
    if (errorCode === OPT_OUT_ERROR_CODE && message.to) await this.recordOptOut(message.to);
    if (applied && isTerminalMessageStatus(status)) void this.events.statusChanged(job, status, errorCode);
  }

  /** 21610: Twilio knows the recipient said STOP; so must we (design §4.7). */
  private async recordOptOut(address: string): Promise<void> {
    try {
      await this.optOuts.setStatus({
        channel: 'sms',
        address,
        status: 'opted_out',
        source: 'error_21610',
        messagingServiceSid: this.twilio.messagingServiceSid,
      });
      void this.events.optOutChanged({ channel: 'sms', address, status: 'opted_out', source: 'error_21610' });
    } catch (error) {
      this.logger.error(`Could not record opt-out for ${address}: ${error instanceof Error ? error.message : error}`);
    }
  }
}
