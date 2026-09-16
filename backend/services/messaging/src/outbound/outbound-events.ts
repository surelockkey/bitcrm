import { Injectable, Logger, Optional } from '@nestjs/common';
import { SnsPublisherService } from '@bitcrm/shared';
import {
  MESSAGE_EVENT_TOPIC,
  MessageEventType,
  type Conversation,
  type ConversationUpdatedEvent,
  type Message,
  type MessageReceivedEvent,
  type MessageSentEvent,
  type MessageStatus,
  type MessageStatusChangedEvent,
  type OptOutChangedEvent,
} from '@bitcrm/types';

/**
 * The `message-events` the outbound path emits (design §7.3): fire-and-
 * forget, never failing the write that caused them (CLAUDE.md §6). The
 * publisher is `@Optional()` so unit tests build the services with `new`,
 * and a missing topic ARN (local dev) is a debug line, not an error.
 *
 * TODO(M12): the realtime bus (`messaging:events` over Redis → SSE) hangs
 * off the same call sites; the realtime module can subscribe here.
 */
@Injectable()
export class OutboundEventsPublisher {
  private readonly logger = new Logger(OutboundEventsPublisher.name);

  constructor(@Optional() private readonly sns?: SnsPublisherService) {}

  messageSent(m: Message, providerSid: string): Promise<void> {
    const payload: MessageSentEvent = {
      messageId: m.id,
      conversationId: m.conversationId,
      channel: m.channel,
      to: m.to,
      businessNumber: m.businessNumber,
      sentByUserId: m.sentByUserId,
      automationRuleId: m.automationRuleId,
      dealId: m.dealId,
      providerSid,
    };
    return this.publish(MessageEventType.MESSAGE_SENT, payload);
  }

  /**
   * A team / group in-app line landed for its members (design §6) — the
   * `message.received` a notifier (push, digest) subscribes to, with the
   * thread's party (`user` / `group`) so it knows whom to wake.
   */
  messageReceived(m: Message, conversation: Pick<Conversation, 'partyKind' | 'partyId'>): Promise<void> {
    const payload: MessageReceivedEvent = {
      messageId: m.id,
      conversationId: m.conversationId,
      channel: m.channel,
      from: m.from,
      to: m.to,
      partyKind: conversation.partyKind,
      partyId: conversation.partyId,
      dealId: m.dealId,
      providerSid: m.providerSid,
      createdAt: m.createdAt,
    };
    return this.publish(MessageEventType.MESSAGE_RECEIVED, payload);
  }

  statusChanged(key: { messageId: string; conversationId: string }, status: MessageStatus, errorCode?: string): Promise<void> {
    const payload: MessageStatusChangedEvent = {
      messageId: key.messageId,
      conversationId: key.conversationId,
      status,
      ...(errorCode ? { errorCode } : {}),
    };
    return this.publish(MessageEventType.MESSAGE_STATUS_CHANGED, payload);
  }

  conversationUpdated(conversationId: string): Promise<void> {
    const payload: ConversationUpdatedEvent = { conversationId };
    return this.publish(MessageEventType.CONVERSATION_UPDATED, payload);
  }

  optOutChanged(payload: OptOutChangedEvent): Promise<void> {
    return this.publish(MessageEventType.OPT_OUT_CHANGED, payload);
  }

  private async publish(eventType: string, payload: unknown): Promise<void> {
    if (!this.sns) return;
    try {
      await this.sns.publish(MESSAGE_EVENT_TOPIC, eventType, payload);
    } catch (error) {
      this.logger.debug(`${eventType} not published: ${error instanceof Error ? error.message : error}`);
    }
  }
}
