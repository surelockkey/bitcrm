import { type MessageChannel } from '../enums/message-channel.enum';
import { type MessageStatus } from '../enums/message-status.enum';
import { type ConversationPartyKind } from '../enums/conversation-kind.enum';
import {
  type OptOutChannel,
  type OptOutSource,
  type OptOutStatus,
} from '../enums/opt-out.enum';

/**
 * Canonical contract for events published on the `message-events` SNS topic.
 * Publisher: messaging-service. Consumers: search-service
 * (`conversation.updated` → reindex the conversation document); the rest are
 * for automations and reporting to subscribe to later.
 */
export const MESSAGE_EVENT_TOPIC = 'message-events' as const;

export const MessageEventType = {
  /** An inbound message was stored. */
  MESSAGE_RECEIVED: 'message.received',
  /** The provider accepted an outbound message (it has a provider sid). */
  MESSAGE_SENT: 'message.sent',
  /** An outbound message reached a terminal status. */
  MESSAGE_STATUS_CHANGED: 'message.status_changed',
  /** Anything about a conversation changed — search reindexes it. */
  CONVERSATION_UPDATED: 'conversation.updated',
  /** STOP/START, Twilio 21610, SES bounce/complaint or a manual change. */
  OPT_OUT_CHANGED: 'opt_out.changed',
} as const;

export type MessageEventType = (typeof MessageEventType)[keyof typeof MessageEventType];

// --- Payloads ---

export interface MessageReceivedEvent {
  messageId: string;
  conversationId: string;
  channel: MessageChannel;
  from?: string;
  to?: string;
  partyKind: ConversationPartyKind;
  partyId?: string;
  dealId?: string;
  providerSid?: string;
  createdAt: string;
}

export interface MessageSentEvent {
  messageId: string;
  conversationId: string;
  channel: MessageChannel;
  to?: string;
  businessNumber?: string;
  sentByUserId?: string;
  automationRuleId?: string;
  dealId?: string;
  providerSid: string;
}

export interface MessageStatusChangedEvent {
  messageId: string;
  conversationId: string;
  status: MessageStatus;
  errorCode?: string;
}

export interface ConversationUpdatedEvent {
  conversationId: string;
}

export interface OptOutChangedEvent {
  channel: OptOutChannel;
  address: string;
  status: OptOutStatus;
  source: OptOutSource;
}
