import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { MESSAGE_STATUS_RANK, isTerminalMessageStatus, type Message, type MessageStatus } from '@bitcrm/types';
import { ConversationsRepository } from '../conversations/conversations.repository';
import { MessagesRepository, type MessageKey } from '../messages/messages.repository';
import { OutboundEventsPublisher } from '../outbound/outbound-events';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { htmlToText } from '../templates/html-text';
import { EmailAddressResolver } from './email-address.resolver';
import { textToHtml } from './email-body';
import { EmailMessagesRepository } from './email-messages.repository';
import { EmailSender, type EmailSendResult } from './email-sender';
import { EMAIL_CONFIG, type EmailConfig } from './email.config';
import { classifySesError, describeSesError, sesMessageIdHeader } from './ses-error.map';

/** No configured sender at send time — a stable failure, not a retry. */
export const EMAIL_NOT_CONFIGURED_CODE = 'EMAIL_NOT_CONFIGURED';

/**
 * The send half of outbound email (design §5, M17): the `message.send` job
 * of an `email` message, handed over by `OutboundWorker`. Claim it
 * (`markSending`), resolve the sender and the reply-to token, hand the
 * rendered bodies and stored attachments to `EmailSender`, record the SES
 * message id (`PSID#`, `providerSid`, `emailMessageId`) and mark it `sent` —
 * SES has no "queued" state a callback would move it out of; `Delivery`,
 * `Bounce` and friends refine the status through the events consumer.
 *
 * Idempotency: SES has no list API to reconcile a dead attempt against, but
 * every send is tagged with the message key, so a send that did go out
 * produces a `Send` event that advances the status within seconds. A claim
 * that cannot be taken on a message still `sending` after the queue's 90 s
 * visibility timeout therefore means the earlier attempt died before the
 * call — it is sent again. Transient SES errors throw so SQS redelivers;
 * stable ones mark the message `failed` with the exception name.
 */
@Injectable()
export class EmailOutboundWorker {
  private readonly logger = new Logger(EmailOutboundWorker.name);

  constructor(
    private readonly messages: MessagesRepository,
    private readonly emailMessages: EmailMessagesRepository,
    private readonly addresses: EmailAddressResolver,
    private readonly sender: EmailSender,
    private readonly events: OutboundEventsPublisher,
    @Inject(EMAIL_CONFIG) private readonly config: Pick<EmailConfig, 'awsRegion'>,
    @Optional() private readonly realtime?: RealtimePublisher,
    /** M18: `ADDR#<email>` is written after a send so a fresh mail from the recipient routes back here. */
    @Optional() private readonly conversations?: ConversationsRepository,
  ) {}

  async process(message: Message, job: MessageKey): Promise<void> {
    if (message.direction !== 'outbound' || message.channel !== 'email' || !message.to) {
      this.logger.warn(`Message ${message.id} is not a deliverable outbound email; dropping`);
      return;
    }
    if (message.providerSid) {
      await this.messages.putProviderSidPointer(message.providerSid, job);
      return;
    }
    if (message.status !== 'queued' && message.status !== 'sending') return;

    const claimed = await this.messages.markSending(job);
    if (!claimed) {
      if (!message.sendingStartedAt) return; // another worker holds the claim
      const fresh = await this.messages.get(job);
      if (!fresh || fresh.providerSid || MESSAGE_STATUS_RANK[fresh.status] > MESSAGE_STATUS_RANK.sending) return;
      this.logger.warn(`Resending ${message.id}: the attempt started ${message.sendingStartedAt} never reached SES`);
    }

    const sender = await this.addresses.resolve(message.conversationId);
    if (!sender) {
      await this.applyStatus(
        message,
        job,
        'failed',
        undefined,
        EMAIL_NOT_CONFIGURED_CODE,
        describeSesError(EMAIL_NOT_CONFIGURED_CODE, 'MESSAGING_EMAIL_FROM is not set'),
      );
      void this.events.conversationUpdated(message.conversationId);
      return;
    }
    const from = message.from ?? sender.from;
    const html = message.bodyHtml ?? (message.body ? textToHtml(message.body) : undefined);
    const text = message.body ?? (html ? htmlToText(html) : '');

    let result: EmailSendResult;
    try {
      result = await this.sender.send({
        conversationId: message.conversationId,
        messageId: message.id,
        createdAt: message.createdAt,
        from,
        fromHeader: from === sender.from ? sender.fromHeader : from,
        replyTo: sender.replyTo,
        to: message.to,
        cc: message.cc,
        subject: message.subject?.trim() || '(no subject)',
        text,
        html,
        inReplyTo: message.inReplyTo,
        references: message.references,
        attachments: message.attachments,
      });
    } catch (error) {
      await this.failedOrRetry(message, job, error);
      return;
    }
    await this.accepted(message, job, result, from);
  }

  // ------------------------------------------------------------ internals

  private async accepted(message: Message, job: MessageKey, result: EmailSendResult, from: string): Promise<void> {
    const emailMessageId = sesMessageIdHeader(result.messageId, this.config.awsRegion);
    const pointerNew = await this.messages.putProviderSidPointer(result.messageId, job);
    await this.emailMessages.attachSesMessageId(job, { providerSid: result.messageId, emailMessageId, from });
    // SES accepted it for delivery: that is "sent" from the inbox's point of
    // view; Delivery / Bounce events move it on (rank-guarded, so a late
    // `Send` event is a no-op).
    await this.applyStatus(
      { ...message, from, emailMessageId },
      job,
      'sent',
      result.messageId,
      undefined,
      undefined,
    );
    if (pointerNew) {
      this.logger.log(`Sent ${message.id} as ${result.messageId} (${result.attachments} attachments)`);
      void this.events.messageSent({ ...message, from }, result.messageId);
    }
    void this.events.conversationUpdated(message.conversationId);
    await this.ensureAddressPointer(message);
  }

  /**
   * The inbound resolver routes a mail by `ADDR#<sender>` when it carries no
   * reply token (a fresh mail rather than a reply). Outbound sends only
   * pointed phones so far; point the email too, once, best effort.
   */
  private async ensureAddressPointer(message: Message): Promise<void> {
    if (!this.conversations || !message.to) return;
    try {
      if (await this.conversations.getByAddress(message.to)) return;
      const conversation = await this.conversations.get(message.conversationId);
      if (!conversation) return;
      await this.conversations.putAddressPointer({
        address: message.to,
        conversationId: conversation.id,
        partyKind: conversation.partyKind,
        partyId: conversation.partyId,
        source: conversation.partyKind === 'none' ? 'manual' : 'crm',
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.warn(`ADDR#${message.to} not written: ${error instanceof Error ? error.message : error}`);
    }
  }

  private async failedOrRetry(message: Message, job: MessageKey, error: unknown): Promise<void> {
    const action = classifySesError(error);
    if (action.kind === 'retry') {
      this.logger.warn(`SES send failed for ${message.id}, will retry: ${action.reason}`);
      throw error;
    }
    this.logger.warn(`SES refused ${message.id}: ${action.errorCode} ${action.errorMessage}`);
    await this.applyStatus(message, job, 'failed', undefined, action.errorCode, action.errorMessage);
    void this.events.conversationUpdated(message.conversationId);
  }

  /** `errorMessage` is the final, already-described line (the classifier and the event map produce it). */
  private async applyStatus(
    message: Message,
    job: MessageKey,
    status: MessageStatus,
    providerSid: string | undefined,
    errorCode: string | undefined,
    errorMessage: string | undefined,
  ): Promise<void> {
    const applied = await this.messages.updateStatus(job, {
      status,
      providerSid,
      errorCode,
      errorMessage: errorCode ? errorMessage : undefined,
    });
    if (applied && isTerminalMessageStatus(status)) void this.events.statusChanged(job, status, errorCode);
    if (applied) {
      const at = new Date().toISOString();
      this.realtime?.messageUpserted(
        {
          ...message,
          status,
          providerSid: providerSid ?? message.providerSid,
          errorCode,
          errorMessage: errorCode ? errorMessage : undefined,
          sentAt: status === 'sent' ? at : message.sentAt,
          updatedAt: at,
        },
        undefined,
        at,
      );
    }
  }
}
