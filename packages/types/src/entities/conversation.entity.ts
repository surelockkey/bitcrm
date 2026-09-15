import { type MessageChannel } from '../enums/message-channel.enum';
import { type MessageDirection } from '../enums/message-direction.enum';
import {
  type ConversationKind,
  type ConversationPartyKind,
  type ConversationPointerKind,
  type ConversationState,
} from '../enums/conversation-kind.enum';

/** Every address the conversation has been carried on — E.164 phones, lowercase emails. */
export interface ConversationAddresses {
  phones: string[];
  emails: string[];
}

/** Lead-provider fields Workiz carried on the header (empty in every export so far). */
export interface ConversationLeadProvider {
  externalLeadProvider?: string;
  thumbtackLeadId?: string;
  angiLeadId?: string;
  yelpLeadId?: string;
}

/**
 * One thread per party (client, employee, unknown number), as in Workiz.
 * Stored as `CONV#<id>` / `METADATA` in the messaging table; the inbox
 * indexes hang off `lastMessageAt` (design §3.1–3.2).
 */
export interface Conversation {
  id: string;
  kind: ConversationKind;
  partyKind: ConversationPartyKind;
  /** Contact / company / user / group id; absent when `partyKind` is `none`. */
  partyId?: string;
  addresses: ConversationAddresses;
  state: ConversationState;
  archivedAt?: string;
  archivedBy?: string;
  /** Team-wide "seen" flag (Workiz `seen`); per-user markers are `READ#` rows. */
  unread: boolean;
  /** Inbound messages since the team last read the thread. */
  unreadCount: number;
  flagged: boolean;
  flaggedAt?: string;
  flaggedBy?: string;
  /** Workiz `accountCategoryId` — only indexed if the owner confirms categories (GSI6). */
  categoryId?: string;
  lastMessageAt?: string;
  lastMessageId?: string;
  /** ≤ 160 characters of the last message body. */
  lastMessagePreview?: string;
  lastChannel?: MessageChannel;
  lastDirection?: MessageDirection;
  /** E.164 company number the client last wrote to or heard from ("sticky" sender). */
  lastBusinessNumber?: string;
  /** Job referenced by the most recent message. */
  lastDealId?: string;
  assignedUserId?: string;
  chatbotActive?: boolean;
  leadProvider?: ConversationLeadProvider;
  /** Inbound arrived while CRM was unreachable; a background pass re-resolves the party. */
  needsResolution?: boolean;
  createdAt: string;
  updatedAt: string;
  /** `workiz:conversation:<menuType>:<externalId>` for imported threads. */
  externalId?: string;
  workizMenuType?: string;
  workizExternalId?: string;
  workizFromExternalCompany?: string;
  workizMaxId?: string;
  /** Only kept for `unknown` / `external`; contact names are read live from CRM. */
  workizName?: string;
  /** Conversation whose client no longer exists (import stub). */
  placeholder?: boolean;
}

/** `CONVOF#<kind>#<id>` / `METADATA` — the idempotent find-or-create pointer. */
export interface ConversationPointer {
  pointerKind: ConversationPointerKind;
  pointerId: string;
  conversationId: string;
  createdAt: string;
}

/** `ADDR#<e164|email>` / `METADATA` — routes an inbound message without calling CRM. */
export interface ConversationAddressPointer {
  address: string;
  conversationId: string;
  partyKind: ConversationPartyKind;
  partyId?: string;
  source: 'crm' | 'import' | 'manual';
  updatedAt: string;
}

/** `CONV#<id>` / `READ#<userId>` — who has read up to where. */
export interface ConversationReadMarker {
  conversationId: string;
  userId: string;
  lastReadAt: string;
  /** Sort key (`MSG#<createdAt>#<messageId>`) of the last message seen. */
  lastReadMessageSk?: string;
}

/** Roles inside a `group` conversation (design §6). */
export const CONVERSATION_MEMBER_ROLES = ['owner', 'member'] as const;
export type ConversationMemberRole = (typeof CONVERSATION_MEMBER_ROLES)[number];

/** `CONV#<id>` / `MEMBER#<userId>` — membership of a team `group` conversation. */
export interface ConversationMember {
  conversationId: string;
  userId: string;
  role: ConversationMemberRole;
  joinedAt: string;
  muted?: boolean;
}

/** Alias used by the team-chat API surface (§6): a member seen from the client. */
export type ConversationParticipant = ConversationMember;
