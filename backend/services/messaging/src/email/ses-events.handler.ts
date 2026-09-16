import { Injectable, Logger, Optional } from '@nestjs/common';
import { BusinessMetricsService } from '@bitcrm/shared';
import { isTerminalMessageStatus } from '@bitcrm/types';
import { parseMessageSk } from '../common/constants/dynamo.constants';
import { MessagesRepository, type MessageKey } from '../messages/messages.repository';
import { OptOutsRepository } from '../opt-outs/opt-outs.repository';
import { OutboundEventsPublisher } from '../outbound/outbound-events';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { TAG_CONVERSATION, TAG_CREATED, TAG_MESSAGE } from './email-sender';
import { SES_EVENT_STATUS, describeSesError, type SesEventType } from './ses-error.map';
import { parseSqsBody } from './sqs-poller';

/** The slice of an SES event (configuration-set event publishing → SNS → SQS) the handler reads. */
export interface SesEvent {
  /** Event publishing uses `eventType`; the older identity notifications use `notificationType`. */
  eventType?: SesEventType | string;
  notificationType?: string;
  mail?: {
    messageId?: string;
    timestamp?: string;
    destination?: string[];
    tags?: Record<string, string[]>;
  };
  delivery?: { timestamp?: string; recipients?: string[] };
  bounce?: {
    bounceType?: 'Permanent' | 'Transient' | 'Undetermined' | string;
    bounceSubType?: string;
    bouncedRecipients?: Array<{ emailAddress?: string; diagnosticCode?: string; status?: string }>;
  };
  complaint?: {
    complaintFeedbackType?: string;
    complainedRecipients?: Array<{ emailAddress?: string }>;
  };
  reject?: { reason?: string };
  failure?: { errorMessage?: string; templateName?: string };
  open?: { timestamp?: string };
  click?: { timestamp?: string; link?: string };
}

export type SesEventOutcome = 'applied' | 'ignored' | 'unknown' | 'dropped';

/**
 * The email status pipeline (design §5, §7.3): SES events arrive on
 * `messaging-email-events` and become message statuses through the same
 * rank-guarded `updateStatus` the Twilio callback uses, so out-of-order and
 * repeated events are no-ops. The message key comes from the `EmailTags`
 * every send carries (`bitcrm-conversation`, `bitcrm-message`,
 * `bitcrm-created`), with `PSID#<sesMessageId>` as the fallback; an event
 * with neither is not ours and is dropped.
 *
 *   Send → sent, Delivery → delivered, Bounce → undelivered (a permanent one
 *   also puts the address on `OPTOUT#email#`), Complaint → opt-out only,
 *   Reject / RenderingFailure → failed, Open → opened, Click → clicked.
 */
@Injectable()
export class SesEventsHandler {
  private readonly logger = new Logger(SesEventsHandler.name);

  constructor(
    private readonly messages: MessagesRepository,
    private readonly optOuts: OptOutsRepository,
    private readonly events: OutboundEventsPublisher,
    @Optional() private readonly realtime?: RealtimePublisher,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {}

  /** The SQS handler: the raw body of one queue message. */
  async handle(body: string): Promise<SesEventOutcome> {
    const parsed = parseSqsBody(body);
    if (!parsed || typeof parsed !== 'object') {
      this.logger.warn('Dropping an SES event that is not JSON');
      return 'dropped';
    }
    const outcome = await this.apply(parsed as SesEvent);
    this.businessMetrics?.sqsMessagesProcessed.inc({ event_type: 'ses.event', status: outcome });
    return outcome;
  }

  async apply(event: SesEvent): Promise<SesEventOutcome> {
    const type = (event.eventType ?? event.notificationType) as SesEventType | undefined;
    const sesMessageId = event.mail?.messageId;
    if (!type || !sesMessageId) {
      this.logger.warn(`Dropping an SES event without a type or message id: ${JSON.stringify(event).slice(0, 200)}`);
      return 'dropped';
    }

    const key = this.keyFromTags(event.mail?.tags) ?? (await this.keyFromPointer(sesMessageId));
    if (!key) {
      this.logger.warn(`SES ${type} for a message that is not ours (${sesMessageId}); dropping`);
      return 'unknown';
    }

    if (type === 'Complaint') {
      await this.recordOptOuts(
        (event.complaint?.complainedRecipients ?? []).map((r) => r.emailAddress),
        'ses_complaint',
        key.conversationId,
      );
      void this.events.conversationUpdated(key.conversationId);
      return 'applied';
    }

    const status = SES_EVENT_STATUS[type];
    if (!status) {
      this.logger.log(`SES ${type} for ${sesMessageId}: nothing to record`);
      return 'ignored';
    }

    const { errorCode, errorMessage } = this.failure(type, event);
    const applied = await this.messages.updateStatus(key, {
      status,
      providerSid: sesMessageId,
      errorCode,
      errorMessage,
      sentAt: type === 'Send' ? event.mail?.timestamp : undefined,
      deliveredAt: type === 'Delivery' ? event.delivery?.timestamp : undefined,
    });

    if (type === 'Bounce' && event.bounce?.bounceType === 'Permanent') {
      await this.recordOptOuts(
        (event.bounce.bouncedRecipients ?? []).map((r) => r.emailAddress),
        'ses_bounce',
        key.conversationId,
      );
    }

    if (!applied) {
      this.logger.debug(`SES ${type} for ${sesMessageId} ignored (out of order or repeated)`);
      return 'ignored';
    }
    if (isTerminalMessageStatus(status)) void this.events.statusChanged(key, status, errorCode);
    void this.events.conversationUpdated(key.conversationId);
    if (this.realtime) {
      const updated = await this.messages.get(key).catch(() => null);
      if (updated) this.realtime.messageUpserted(updated);
    }
    return 'applied';
  }

  // ------------------------------------------------------------ internals

  private failure(type: SesEventType, event: SesEvent): { errorCode?: string; errorMessage?: string } {
    switch (type) {
      case 'Bounce': {
        const permanent = event.bounce?.bounceType === 'Permanent';
        const errorCode = permanent ? 'SES_BOUNCE' : 'SES_BOUNCE_TRANSIENT';
        const detail = event.bounce?.bouncedRecipients?.[0]?.diagnosticCode ?? event.bounce?.bounceSubType;
        return { errorCode, errorMessage: describeSesError(errorCode, detail) };
      }
      case 'Reject':
        return { errorCode: 'SES_REJECT', errorMessage: describeSesError('SES_REJECT', event.reject?.reason) };
      case 'RenderingFailure':
        return {
          errorCode: 'SES_RENDERING_FAILURE',
          errorMessage: describeSesError('SES_RENDERING_FAILURE', event.failure?.errorMessage),
        };
      default:
        return {};
    }
  }

  /** The key the send stamped as tags — no read needed, and it survives a lost `PSID#`. */
  private keyFromTags(tags: Record<string, string[]> | undefined): MessageKey | null {
    const conversationId = tags?.[TAG_CONVERSATION]?.[0];
    const messageId = tags?.[TAG_MESSAGE]?.[0];
    const createdMs = Number(tags?.[TAG_CREATED]?.[0]);
    if (!conversationId || !messageId || !Number.isFinite(createdMs)) return null;
    return { conversationId, messageId, createdAt: new Date(createdMs).toISOString() };
  }

  private async keyFromPointer(sesMessageId: string): Promise<MessageKey | null> {
    const pointer = await this.messages.getProviderSidPointer(sesMessageId);
    if (!pointer) return null;
    const { createdAt, messageId } = parseMessageSk(pointer.messageSk);
    return { conversationId: pointer.conversationId, createdAt, messageId };
  }

  private async recordOptOuts(
    addresses: Array<string | undefined>,
    source: 'ses_bounce' | 'ses_complaint',
    conversationId: string,
  ): Promise<void> {
    for (const raw of addresses) {
      const address = raw?.trim().toLowerCase();
      if (!address) continue;
      try {
        await this.optOuts.setStatus({ channel: 'email', address, status: 'opted_out', source });
        void this.events.optOutChanged({ channel: 'email', address, status: 'opted_out', source });
        this.realtime?.optOutChanged({ channel: 'email', address, status: 'opted_out', conversationId });
      } catch (error) {
        this.logger.error(`Could not record ${source} for ${address}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }
}
