/**
 * How a message travelled. Stored on every message so SMS, email and in-app
 * lines can share one conversation feed (the Workiz Inbox model).
 *
 * - `sms`    — Twilio SMS. MMS is stored as `sms` with `attachments` (the
 *              inbound webhook and the Workiz import both write `sms`);
 *              `mms` exists for callers that want to label a media message
 *              explicitly and must be treated as `sms` for routing/opt-out.
 * - `email`  — SES / Workiz `mail`+`email` history (read-only history until M17).
 * - `in_app` — delivered over SSE inside BitCRM (team chat, office replies).
 * - `note`   — internal note pinned into a thread; never delivered to a party.
 */
export const MESSAGE_CHANNELS = ['sms', 'mms', 'email', 'in_app', 'note'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

/** Channels a user may pick in the composer (`SendMessageDto.channel`). */
export const SENDABLE_MESSAGE_CHANNELS = ['sms', 'email', 'in_app'] as const;
export type SendableMessageChannel = (typeof SENDABLE_MESSAGE_CHANNELS)[number];

/** Channels that carry a Twilio message (opt-out list, sender resolution). */
export const isSmsChannel = (channel: MessageChannel): boolean =>
  channel === 'sms' || channel === 'mms';

/** Attachment MIME types accepted for outbound MMS (design §4.6). */
export const MESSAGE_ATTACHMENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'video/mp4',
  'video/3gpp',
  'text/vcard',
] as const;
export type MessageAttachmentType = (typeof MESSAGE_ATTACHMENT_TYPES)[number];
