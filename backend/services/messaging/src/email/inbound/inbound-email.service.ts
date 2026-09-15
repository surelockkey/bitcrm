import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BusinessMetricsService, S3Service, SnsPublisherService } from '@bitcrm/shared';
import {
  EMAIL_BODY_MAX_LENGTH,
  MESSAGE_ATTACHMENT_LIMIT,
  MESSAGE_EVENT_TOPIC,
  MessageEventType,
  type ConversationUpdatedEvent,
  type Message,
  type MessageAttachment,
  type MessageReceivedEvent,
} from '@bitcrm/types';
import { mediaS3Key } from '../../media/media.constants';
import { MessagesRepository } from '../../messages/messages.repository';
import { RealtimePublisher } from '../../realtime/realtime.publisher';
import { htmlToText } from '../../templates/html-text';
import { EMAIL_CONFIG, type EmailConfig } from '../email.config';
import { parseMail, type ParsedAttachment, type ParsedMail } from '../mime/mime-parser';
import { EmailThreadResolver } from './email-thread.resolver';
import { RawMailStore } from './raw-mail.store';

/** What the queue message says about a mail that landed in S3. */
export interface InboundMailLocation {
  bucket: string;
  key: string;
  /** SES's id for the received mail (the object's basename when the rule wrote it). */
  sesMessageId?: string;
  /** Envelope recipients as SES saw them (`receipt.recipients`). */
  recipients?: string[];
  /** SES arrival time (`mail.timestamp`). */
  receivedAt?: string;
  spamVerdict?: string;
  virusVerdict?: string;
}

export interface InboundEmailResult {
  outcome: 'stored' | 'duplicate' | 'dropped';
  conversationId?: string;
  messageId?: string;
  conversationCreated: boolean;
  route?: string;
  attachmentsStored: number;
  reason?: string;
}

/** `PSID#` for an inbound mail — the SES id (else the object key) with a prefix so it can never collide with an outbound one. */
export const inboundProviderSid = (location: Pick<InboundMailLocation, 'key' | 'sesMessageId'>) =>
  `ses-inbound:${location.sesMessageId ?? location.key.split('/').pop() ?? location.key}`;

/** Where an oversized HTML body goes (design §3.2: `bodyHtmlKey`). */
export const emailHtmlS3Key = (messageId: string) => `messaging/email/${messageId}.html`;

/**
 * The inbound email pipeline (design §5, variant A; the SMS `InboundService`
 * shape): SES stored the mail in S3 and told us where.
 *
 *   1. `PSID#ses-inbound:<sesMessageId>` already written → duplicate;
 *   2. read the raw mail, parse the MIME;
 *   3. thread: reply token → In-Reply-To → `ADDR#` → CRM → unknown (`EmailThreadResolver`);
 *   4. attachments (≤ 10, skipped on a virus verdict) into S3 under
 *      `messaging/<conv>/<msg>/<attachment>` with SSE-KMS, an HTML body over
 *      100 KB into `messaging/email/<msg>.html`;
 *   5. one `appendInbound` transaction (message + PSID# + conversation roll-forward + counters);
 *   6. realtime `message.upserted`, SNS `message.received` + `conversation.updated`.
 *
 * Files are written before the transaction so a retry after a crash never
 * leaves a stored line pointing at nothing; on a duplicate the just-written
 * copies are removed again (best effort).
 */
@Injectable()
export class InboundEmailService {
  private readonly logger = new Logger(InboundEmailService.name);

  constructor(
    private readonly rawMail: RawMailStore,
    private readonly threads: EmailThreadResolver,
    private readonly messages: MessagesRepository,
    private readonly s3: S3Service,
    @Inject(EMAIL_CONFIG) private readonly config: Pick<EmailConfig, 'kmsKeyId'>,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
    @Optional() private readonly realtime?: RealtimePublisher,
  ) {}

  async ingest(location: InboundMailLocation, at: string = new Date().toISOString()): Promise<InboundEmailResult> {
    const providerSid = inboundProviderSid(location);
    const seen = await this.messages.getProviderSidPointer(providerSid);
    if (seen) {
      this.logger.log(`Inbound mail ${providerSid} already stored`);
      return { outcome: 'duplicate', conversationId: seen.conversationId, conversationCreated: false, attachmentsStored: 0 };
    }

    const raw = await this.rawMail.get(location.bucket, location.key);
    const mail = parseMail(raw);
    const sender = mail.from?.address;
    if (!sender) {
      this.logger.warn(`Dropping ${providerSid}: no usable From address`);
      return { outcome: 'dropped', conversationCreated: false, attachmentsStored: 0, reason: 'no sender' };
    }

    const recipients = [...(location.recipients ?? []), ...mail.to.map((a) => a.address), ...mail.cc.map((a) => a.address)];
    const located = await this.threads.resolve(
      { sender, recipients, inReplyTo: mail.inReplyTo, references: mail.references },
      at,
    );

    const messageId = randomUUID();
    const virus = location.virusVerdict?.toUpperCase() === 'FAIL';
    if (virus) this.logger.warn(`${providerSid} failed the virus scan: attachments are not stored`);
    const attachments = virus ? [] : await this.storeAttachments(located.conversation.id, messageId, mail.attachments);
    const bodyHtml = await this.storeHtml(messageId, mail.html);

    const message = this.buildMessage({ id: messageId, mail, sender, providerSid, location, located, attachments, bodyHtml, at });
    const appended = await this.messages.appendInbound({ message, conversation: located.conversation, at });
    if (appended.duplicate) {
      await this.discard(attachments, bodyHtml.key);
      return { outcome: 'duplicate', conversationId: located.conversation.id, conversationCreated: located.created, attachmentsStored: 0 };
    }

    this.businessMetrics?.entityCreated.inc({ entity_type: 'message' });
    if (located.created) this.businessMetrics?.entityCreated.inc({ entity_type: 'conversation' });
    this.logger.log(
      `Inbound mail ${providerSid} from ${sender} → conversation ${located.conversation.id} (${located.conversation.kind}, via ${located.route}, ${attachments.length} attachments)`,
    );

    this.realtime?.messageUpserted(message, appended.conversation, at);
    this.publish<MessageReceivedEvent>(MessageEventType.MESSAGE_RECEIVED, {
      messageId: message.id,
      conversationId: message.conversationId,
      channel: 'email',
      from: message.from,
      to: message.to,
      partyKind: located.conversation.partyKind,
      partyId: located.conversation.partyId,
      dealId: message.dealId,
      providerSid,
      createdAt: message.createdAt,
    });
    this.publish<ConversationUpdatedEvent>(MessageEventType.CONVERSATION_UPDATED, { conversationId: message.conversationId });

    return {
      outcome: 'stored',
      conversationId: message.conversationId,
      messageId: message.id,
      conversationCreated: located.created,
      route: located.route,
      attachmentsStored: attachments.filter((a) => a.status === 'stored').length,
    };
  }

  // -------------------------------------------------------------- internals

  private buildMessage(input: {
    id: string;
    mail: ParsedMail;
    sender: string;
    providerSid: string;
    location: InboundMailLocation;
    located: { conversation: { id: string; partyKind: string } };
    attachments: MessageAttachment[];
    bodyHtml: { inline?: string; key?: string };
    at: string;
  }): Message {
    const { mail, location, located } = input;
    const html = mail.html;
    const text = mail.text ?? (html ? htmlToText(html) : undefined);
    const to = location.recipients?.[0]?.toLowerCase() ?? mail.to[0]?.address;
    const cc = mail.cc.map((a) => a.address).filter((a) => a !== to);
    return {
      id: input.id,
      conversationId: located.conversation.id,
      channel: 'email',
      direction: 'inbound',
      subject: mail.subject,
      body: text || undefined,
      bodyHtml: input.bodyHtml.inline,
      bodyHtmlKey: input.bodyHtml.key,
      from: input.sender,
      to,
      cc: cc.length ? cc : undefined,
      contactAddress: input.sender,
      emailMessageId: mail.messageId,
      inReplyTo: mail.inReplyTo,
      references: mail.references.length ? mail.references : undefined,
      status: 'received',
      provider: 'ses',
      providerSid: input.providerSid,
      origin: located.conversation.partyKind === 'user' ? 'employee' : 'contact',
      sentByName: mail.from?.name,
      attachments: input.attachments.length ? input.attachments : undefined,
      createdAt: location.receivedAt ?? input.at,
      updatedAt: input.at,
    };
  }

  /** Every part into S3 (SSE-KMS) before the line is written; a failed copy is recorded as `failed`, not retried. */
  private async storeAttachments(conversationId: string, messageId: string, parts: ParsedAttachment[]): Promise<MessageAttachment[]> {
    if (parts.length > MESSAGE_ATTACHMENT_LIMIT) {
      this.logger.warn(`${parts.length} attachments on ${messageId}; only the first ${MESSAGE_ATTACHMENT_LIMIT} are kept`);
    }
    const stored: MessageAttachment[] = [];
    for (const part of parts.slice(0, MESSAGE_ATTACHMENT_LIMIT)) {
      const id = randomUUID();
      const s3Key = mediaS3Key(conversationId, messageId, id);
      const base: MessageAttachment = { id, fileName: part.fileName, contentType: part.contentType, size: part.content.byteLength, status: 'failed' };
      try {
        await this.s3.putObject(s3Key, part.content, {
          contentType: part.contentType,
          kmsKeyId: this.config.kmsKeyId,
          metadata: { source: 'ses-inbound', ...(part.contentId && { contentid: part.contentId }) },
        });
        stored.push({ ...base, status: 'stored', s3Key });
      } catch (error) {
        // S3 down is transient: let the whole mail be retried rather than store a line with a hole in it.
        throw new Error(`attachment ${part.fileName} not stored: ${error instanceof Error ? error.message : error}`);
      }
    }
    return stored;
  }

  private async storeHtml(messageId: string, html: string | undefined): Promise<{ inline?: string; key?: string }> {
    if (!html) return {};
    if (html.length <= EMAIL_BODY_MAX_LENGTH) return { inline: html };
    const key = emailHtmlS3Key(messageId);
    await this.s3.putObject(key, html, { contentType: 'text/html; charset=utf-8', kmsKeyId: this.config.kmsKeyId });
    return { key };
  }

  private async discard(attachments: MessageAttachment[], htmlKey: string | undefined): Promise<void> {
    const keys = [...attachments.map((a) => a.s3Key), htmlKey].filter((k): k is string => !!k);
    for (const key of keys) {
      await this.s3.deleteObject(key).catch((error) =>
        this.logger.warn(`orphan ${key} not removed: ${error instanceof Error ? error.message : error}`),
      );
    }
  }

  private publish<T>(eventType: string, payload: T): void {
    this.snsPublisher
      ?.publish(MESSAGE_EVENT_TOPIC, eventType, payload)
      .then(() => this.businessMetrics?.eventsPublished.inc({ event_type: eventType }))
      .catch((err) => {
        this.businessMetrics?.eventsFailed.inc({ event_type: eventType });
        this.logger.warn(`SNS publish ${eventType} failed: ${err instanceof Error ? err.message : err}`);
      });
  }
}
