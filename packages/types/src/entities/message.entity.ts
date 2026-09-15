import { type MessageChannel } from '../enums/message-channel.enum';
import { type MessageDirection } from '../enums/message-direction.enum';
import { type MessageStatus } from '../enums/message-status.enum';
import {
  type MessageAttachmentStatus,
  type MessageOrigin,
  type MessageProvider,
  type SenderSource,
} from '../enums/message-origin.enum';

/**
 * One file on a message. Live MMS media is copied into S3
 * (`messaging/<conversationId>/<messageId>/<attachmentId>`); Workiz history
 * arrives as `deferred` with only `sourceUrl` until the media stage runs.
 */
export interface MessageAttachment {
  id: string;
  fileName: string;
  contentType: string;
  size?: number;
  status: MessageAttachmentStatus;
  s3Key?: string;
  sourceUrl?: string;
  providerMediaSid?: string;
  workizFileId?: string;
}

/** Cap enforced by Twilio and the DTO alike. */
export const MESSAGE_ATTACHMENT_LIMIT = 10;
/** Longest SMS body the composer accepts (10 GSM-7 segments). */
export const SMS_BODY_MAX_LENGTH = 1600;
/** Longest email body the service accepts inline; bigger HTML goes to S3 (`bodyHtmlKey`). */
export const EMAIL_BODY_MAX_LENGTH = 100_000;
/** `lastMessagePreview` on the conversation is trimmed to this. */
export const MESSAGE_PREVIEW_LENGTH = 160;

/**
 * One line in a conversation feed, any channel.
 * Stored as `CONV#<conversationId>` / `MSG#<createdAt>#<id>` (design §3.2);
 * `createdAt` is ISO-8601 with milliseconds so the sort key orders the feed.
 */
export interface Message {
  id: string;
  conversationId: string;
  channel: MessageChannel;
  /** Exact Workiz `via` (`sms`, `mail`, `email`, `inApp`, `inAppOfficeReply`, `inGroup`, `mobilesms`). */
  workizVia?: string;
  direction: MessageDirection;
  /** Plain text. Empty bodies are not stored (undefined), never `""`. */
  body?: string;
  /** Email HTML when ≤ 100 KB; larger bodies live in S3 under `bodyHtmlKey`. */
  bodyHtml?: string;
  bodyHtmlKey?: string;
  subject?: string;
  /** E.164 or email address of the sender. */
  from?: string;
  /** E.164 or email address of the recipient. */
  to?: string;
  cc?: string[];
  /** RFC 5322 threading for live email. */
  emailMessageId?: string;
  inReplyTo?: string;
  references?: string[];
  /** The company number involved (live messages only — Workiz history never recorded it). */
  businessNumber?: string;
  senderSource?: SenderSource;
  /** Workiz `contact_phone` / `contact_email` — the party's address on this line. */
  contactAddress?: string;
  status: MessageStatus;
  /** Raw Workiz status when it differed from the normalised one. */
  workizStatus?: string;
  errorCode?: string;
  errorMessage?: string;
  /** Twilio `NumSegments`. */
  segments?: number;
  encoding?: string;
  provider?: MessageProvider;
  /** `SM…` / `MM…` for Twilio, the ESP id for email. */
  providerSid?: string;
  /** `workiz` for imported SIDs, which do not resolve in the company's Twilio account. */
  providerAccount?: string;
  origin: MessageOrigin;
  sentByUserId?: string;
  /** Display name when the author could not be mapped to a user (history). */
  sentByName?: string;
  automationRuleId?: string;
  notificationId?: string;
  templateId?: string;
  dealId?: string;
  /** Workiz `json.job_id` — kept even when the job was never generated. */
  workizJobId?: string;
  entityType?: string;
  entityId?: string;
  callSid?: string;
  recordingUrl?: string;
  attachments?: MessageAttachment[];
  /** Workiz per-message `seen`; live reads are tracked on the conversation. */
  seen?: boolean;
  readAt?: string;
  flagged?: boolean;
  flaggedAt?: string;
  flaggedBy?: string;
  createdAt: string;
  sentAt?: string;
  deliveredAt?: string;
  updatedAt: string;
  /** Set by the outbound worker right before it calls the provider (design §4.4). */
  sendingStartedAt?: string;
  /** Everything else Workiz carried in `json` / `job_insights`, only when non-empty. */
  workizMeta?: Record<string, unknown>;
  /** `workiz:message:<id>` for imported lines. */
  externalId?: string;
}
