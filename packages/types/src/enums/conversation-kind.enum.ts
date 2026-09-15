/**
 * Which inbox category a conversation belongs to — Workiz `menu_type`
 * (Client / Unknown / Tech / Group / External) normalised:
 *
 * - `client`   — a contact or company (SMS + email in one feed)
 * - `unknown`  — a number or email that resolved to nobody in CRM
 * - `team`     — one employee: in-app chat plus SMS to their personal phone
 * - `group`    — several employees (members stored as `MEMBER#<userId>` rows)
 * - `external` — an outside company (Workiz `External`, two conversations)
 */
export const CONVERSATION_KINDS = ['client', 'unknown', 'team', 'group', 'external'] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

/** `archived` conversations leave the open inbox but keep their history. */
export const CONVERSATION_STATES = ['open', 'archived'] as const;
export type ConversationState = (typeof CONVERSATION_STATES)[number];

/**
 * Who the other side of the conversation is. `none` is a placeholder for
 * system conversations imported without a party (Workiz `-1` / `0`).
 */
export const CONVERSATION_PARTY_KINDS = ['contact', 'company', 'user', 'group', 'none'] as const;
export type ConversationPartyKind = (typeof CONVERSATION_PARTY_KINDS)[number];

/**
 * Key of the `CONVOF#<kind>#<id>` pointer that makes find-or-create
 * idempotent. Parties use their own kind; an unknown number or email is keyed
 * by the address itself (`CONVOF#address#<e164|email>`).
 */
export const CONVERSATION_POINTER_KINDS = ['contact', 'company', 'user', 'group', 'address'] as const;
export type ConversationPointerKind = (typeof CONVERSATION_POINTER_KINDS)[number];

/** Inbox tabs (`GET /conversations?view=`). */
export const CONVERSATION_VIEWS = ['all', 'unread', 'flagged', 'archived'] as const;
export type ConversationView = (typeof CONVERSATION_VIEWS)[number];
