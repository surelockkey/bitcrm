/**
 * Who caused a message to exist.
 * - `user`       — a BitCRM user typed it
 * - `automation` — an automation rule fired (`automationRuleId`)
 * - `system`     — outbound with no author (documents, notifications)
 * - `contact`    — inbound from a client / unknown number
 * - `employee`   — inbound from a technician's personal phone or the app
 */
export const MESSAGE_ORIGINS = ['user', 'automation', 'system', 'contact', 'employee'] as const;
export type MessageOrigin = (typeof MESSAGE_ORIGINS)[number];

/** Which provider carried the message; `workiz` for imported history. */
export const MESSAGE_PROVIDERS = ['twilio', 'ses', 'workiz'] as const;
export type MessageProvider = (typeof MESSAGE_PROVIDERS)[number];

/**
 * Which rung of the sender chain (design §4.2) chose `businessNumber` —
 * answers "why did the client see that number?" from the record itself.
 */
export const SENDER_SOURCES = ['agent', 'sticky', 'called', 'area', 'source', 'default', 'pool'] as const;
export type SenderSource = (typeof SENDER_SOURCES)[number];

/** Lifecycle of one attachment on a message. */
export const MESSAGE_ATTACHMENT_STATUSES = ['pending', 'stored', 'failed', 'deferred'] as const;
export type MessageAttachmentStatus = (typeof MESSAGE_ATTACHMENT_STATUSES)[number];
