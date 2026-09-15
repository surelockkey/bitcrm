import {
  type ConversationKind,
  type ConversationPointerKind,
  type ConversationState,
  type OptOutChannel,
} from '@bitcrm/types';

/**
 * One table for the whole messaging domain — `bitcrm-<env>-messaging` in
 * AWS (Terraform `infra/dev/data_plane.tf`), `BitCRM_Messaging` locally.
 * Tests point this at `BitCRM_Messaging_Test`.
 */
export const MESSAGING_TABLE = process.env.MESSAGING_TABLE || 'BitCRM_Messaging';

// ---------------------------------------------------------------------------
// Indexes (design §3.1). Names and key attributes MUST match Terraform.
//
//   GSI1 InboxIndex            GSI1PK = INBOX#<open|archived>#<YYYY>
//                              GSI1SK = <lastMessageAt>#<conversationId>   every conversation
//   GSI2 UnreadIndex (sparse)  GSI2PK = UNREAD#<YYYY>                       open + unread only
//   GSI3 CategoryIndex         GSI3PK = CAT#<kind>#<YYYY>                   conversations
//                              GSI3PK = CATALOG#MESSAGE_TEMPLATE, GSI3SK = <title lower>#<id>  templates
//   GSI4 JobIndex (sparse)     GSI4PK = JOB#<dealId>, GSI4SK = <createdAt>#<messageId>  messages with a job
//   GSI5 FlagIndex (sparse)    conversation: FLAG#conversation / <lastMessageAt>#<conversationId>
//                              message:      FLAG#message#<YYYY> / <createdAt>#<messageId>
//   GSI6 AccountCategoryIndex  GSI6PK = ACCTCAT#<categoryId>#<YYYY>          conversations with a category
//
// There is deliberately NO global message index (§3.4): messages live in
// their conversation's partition and, when job-linked, in JobIndex. Inbox
// partitions are split by year and by filter so reads are key-condition-only
// — never a FilterExpression over a hot partition (the CALL#ALL mistake).
// ---------------------------------------------------------------------------
export const MESSAGING_GSI1_NAME = 'InboxIndex';
export const MESSAGING_GSI2_NAME = 'UnreadIndex';
export const MESSAGING_GSI3_NAME = 'CategoryIndex';
export const MESSAGING_GSI4_NAME = 'JobIndex';
export const MESSAGING_GSI5_NAME = 'FlagIndex';
export const MESSAGING_GSI6_NAME = 'AccountCategoryIndex';

/** Index number → display name, in the order Terraform declares them. */
export const MESSAGING_GSIS: ReadonlyArray<{ n: 1 | 2 | 3 | 4 | 5 | 6; name: string }> = [
  { n: 1, name: MESSAGING_GSI1_NAME },
  { n: 2, name: MESSAGING_GSI2_NAME },
  { n: 3, name: MESSAGING_GSI3_NAME },
  { n: 4, name: MESSAGING_GSI4_NAME },
  { n: 5, name: MESSAGING_GSI5_NAME },
  { n: 6, name: MESSAGING_GSI6_NAME },
];

/** TTL attribute (epoch seconds) — only service pointers such as CLIENTMSG# carry it. */
export const MESSAGING_TTL_ATTRIBUTE = 'expiresAt';

export const METADATA_SK = 'METADATA';

// ---------------------------------------------------------------------------
// Item keys (design §3.2)
// ---------------------------------------------------------------------------

/** `CONV#<conversationId>` — partition of a conversation and all its messages. */
export const conversationPk = (conversationId: string) => `CONV#${conversationId}`;

export const MESSAGE_SK_PREFIX = 'MSG#';
/** `MSG#<createdAt>#<messageId>` — time-ordered within the conversation partition. */
export const messageSk = (createdAt: string, messageId: string) =>
  `${MESSAGE_SK_PREFIX}${createdAt}#${messageId}`;

/** Splits `MSG#<createdAt>#<messageId>` back into its parts. */
export function parseMessageSk(sk: string): { createdAt: string; messageId: string } {
  if (!sk.startsWith(MESSAGE_SK_PREFIX)) throw new Error(`Not a message sort key: ${sk}`);
  const rest = sk.slice(MESSAGE_SK_PREFIX.length);
  const sep = rest.lastIndexOf('#');
  if (sep < 0) throw new Error(`Not a message sort key: ${sk}`);
  return { createdAt: rest.slice(0, sep), messageId: rest.slice(sep + 1) };
}

/** `READ#<userId>` under the conversation — per-user read marker. */
export const readMarkerSk = (userId: string) => `READ#${userId}`;
export const READ_SK_PREFIX = 'READ#';
/** `MEMBER#<userId>` under the conversation — group membership (§6). */
export const memberSk = (userId: string) => `MEMBER#${userId}`;
export const MEMBER_SK_PREFIX = 'MEMBER#';
/**
 * `MEMBER#` rows also carry `GSI3PK = MEMBEROF#<userId>` / `GSI3SK = <joinedAt>#<conversationId>`
 * — the "which groups am I in" adjacency on the CategoryIndex, the same
 * constant-partition trick the template catalog uses (CLAUDE.md §5).
 */
export const memberOfGsi3Pk = (userId: string) => `MEMBEROF#${userId}`;
export const memberOfGsi3Sk = (joinedAt: string, conversationId: string) => `${joinedAt}#${conversationId}`;

/**
 * `CONVOF#<kind>#<id>` / METADATA — party → conversation. Written with
 * `attribute_not_exists(PK)` so find-or-create is idempotent (like EXTOF#).
 * Unknown numbers and emails use `CONVOF#address#<e164|email>`.
 */
export const convOfPk = (kind: ConversationPointerKind, id: string) => `CONVOF#${kind}#${id}`;

/** `ADDR#<e164|email>` / METADATA — inbound routing without a CRM call. */
export const addressPk = (address: string) => `ADDR#${address}`;

/** `PSID#<providerSid>` / METADATA — webhook and retry deduplication. */
export const providerSidPk = (providerSid: string) => `PSID#${providerSid}`;

/** `CLIENTMSG#<clientMessageId>` / METADATA — double-submit guard, TTL 7 days. */
export const clientMessagePk = (clientMessageId: string) => `CLIENTMSG#${clientMessageId}`;
export const CLIENT_MESSAGE_TTL_SECONDS = 7 * 24 * 60 * 60;

/** `OPTOUT#<sms|email>#<address>` / METADATA. */
export const optOutPk = (channel: OptOutChannel, address: string) =>
  `OPTOUT#${channel}#${address}`;

/** `TEMPLATE#<id>` / METADATA; listed through the GSI3 catalog partition. */
export const templatePk = (templateId: string) => `TEMPLATE#${templateId}`;
export const TEMPLATE_CATALOG_GSI3PK = 'CATALOG#MESSAGE_TEMPLATE';
/** `<title lower>#<id>` — alphabetical catalog order, unique per template. */
export const templateCatalogSk = (title: string, templateId: string) =>
  `${title.trim().toLowerCase()}#${templateId}`;

/** Singletons. */
export const SETTINGS_PK = 'MESSAGING#SETTINGS';
export const COUNTERS_PK = 'INBOX#COUNTERS';

/** `AUTOMATION#<id>` / METADATA — Workiz rules stored as data until M21. */
export const automationPk = (ruleId: string) => `AUTOMATION#${ruleId}`;

// ---------------------------------------------------------------------------
// Index keys
// ---------------------------------------------------------------------------

/** The `YYYY` bucket of an ISO timestamp. */
export const yearOf = (iso: string) => iso.slice(0, 4);

/**
 * Oldest year the inbox walks back to when a page is not filled from the
 * current year. Workiz history starts in the mid-2010s; anything older is an
 * empty (and cheap) query. Override with MESSAGING_INBOX_MIN_YEAR.
 */
export const INBOX_MIN_YEAR = Number(process.env.MESSAGING_INBOX_MIN_YEAR || 2015);

export const inboxGsi1Pk = (state: ConversationState, year: string) => `INBOX#${state}#${year}`;
export const unreadGsi2Pk = (year: string) => `UNREAD#${year}`;
export const categoryGsi3Pk = (kind: ConversationKind, year: string) => `CAT#${kind}#${year}`;
export const jobGsi4Pk = (dealId: string) => `JOB#${dealId}`;
export const FLAG_CONVERSATION_GSI5PK = 'FLAG#conversation';
export const flagMessageGsi5Pk = (year: string) => `FLAG#message#${year}`;
export const accountCategoryGsi6Pk = (categoryId: string, year: string) =>
  `ACCTCAT#${categoryId}#${year}`;

/** `<lastMessageAt>#<conversationId>` — sort key shared by every conversation index. */
export const activitySk = (lastMessageAt: string, conversationId: string) =>
  `${lastMessageAt}#${conversationId}`;
/** `<createdAt>#<messageId>` — sort key of the message indexes (GSI4, GSI5). */
export const messageIndexSk = (createdAt: string, messageId: string) =>
  `${createdAt}#${messageId}`;
