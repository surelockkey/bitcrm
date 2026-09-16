import { type Conversation, type ConversationKind } from '@bitcrm/types';
import {
  FLAG_CONVERSATION_GSI5PK,
  METADATA_SK,
  accountCategoryGsi6Pk,
  activitySk,
  categoryGsi3Pk,
  conversationPk,
  inboxGsi1Pk,
  unreadGsi2Pk,
  yearOf,
} from '../common/constants/dynamo.constants';
import { compact, stripKeys } from '../common/items';

/**
 * Everything that derives a conversation's index keys from its state, in one
 * place, so the conversations repository (archive / flag / read) and the
 * messages repository (append) rewrite the same attributes the same way.
 *
 * Index membership (design §3.1):
 *   GSI1  INBOX#<state>#<YYYY>          every conversation
 *   GSI2  UNREAD#<YYYY>                 only open + unread          (sparse)
 *   GSI3  CAT#<kind>#<YYYY>             only open (category tabs)   (sparse)
 *   GSI5  FLAG#conversation             only flagged, any state     (sparse)
 *   GSI6  ACCTCAT#<categoryId>#<YYYY>   only open with a category   (sparse)
 * Sort key everywhere: <lastMessageAt ?? createdAt>#<conversationId>; the
 * YYYY bucket is the year of that same timestamp.
 */
export interface ConversationIndexKeys {
  GSI1PK: string;
  GSI1SK: string;
  GSI2PK?: string;
  GSI2SK?: string;
  GSI3PK?: string;
  GSI3SK?: string;
  GSI5PK?: string;
  GSI5SK?: string;
  GSI6PK?: string;
  GSI6SK?: string;
}

export const CONVERSATION_INDEX_ATTRS = [
  'GSI1PK', 'GSI1SK',
  'GSI2PK', 'GSI2SK',
  'GSI3PK', 'GSI3SK',
  'GSI5PK', 'GSI5SK',
  'GSI6PK', 'GSI6SK',
] as const;

/** The timestamp the inbox sorts and buckets by. */
export const conversationActivityAt = (c: Pick<Conversation, 'lastMessageAt' | 'createdAt'>) =>
  c.lastMessageAt ?? c.createdAt;

/** Whether the conversation is in the unread index and the unread badge. */
export const countsAsUnread = (c: Pick<Conversation, 'state' | 'unread'>) =>
  c.state === 'open' && c.unread === true;

export function conversationIndexKeys(c: Conversation): ConversationIndexKeys {
  const at = conversationActivityAt(c);
  const year = yearOf(at);
  const sk = activitySk(at, c.id);
  const open = c.state === 'open';

  const keys: ConversationIndexKeys = {
    GSI1PK: inboxGsi1Pk(c.state, year),
    GSI1SK: sk,
  };
  if (countsAsUnread(c)) {
    keys.GSI2PK = unreadGsi2Pk(year);
    keys.GSI2SK = sk;
  }
  if (open) {
    keys.GSI3PK = categoryGsi3Pk(c.kind, year);
    keys.GSI3SK = sk;
  }
  if (c.flagged) {
    keys.GSI5PK = FLAG_CONVERSATION_GSI5PK;
    keys.GSI5SK = sk;
  }
  if (open && c.categoryId) {
    keys.GSI6PK = accountCategoryGsi6Pk(c.categoryId, year);
    keys.GSI6SK = sk;
  }
  return keys;
}

/** Full item for a Put: `CONV#<id>` / `METADATA` + entity + index keys. */
export function conversationItem(c: Conversation): Record<string, unknown> {
  return {
    PK: conversationPk(c.id),
    SK: METADATA_SK,
    ...compact(c as unknown as Record<string, unknown>),
    ...conversationIndexKeys(c),
  };
}

export function toConversation(item: Record<string, unknown>): Conversation {
  const c = stripKeys<Conversation>(item);
  return {
    ...c,
    unread: Boolean(c.unread),
    unreadCount: Number(c.unreadCount ?? 0),
    flagged: Boolean(c.flagged),
    addresses: c.addresses ?? { phones: [], emails: [] },
  };
}

export type ConversationMutableField = keyof Omit<Conversation, 'id' | 'createdAt'>;

export interface ConversationUpdateExpression {
  UpdateExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, unknown>;
}

/**
 * The UpdateItem body that brings a stored conversation to `next` (§3.5):
 * the named fields are SET when defined and REMOVEd when undefined,
 * `updatedAt` is always SET, and all five index key pairs are recomputed —
 * a sparse key `next` no longer qualifies for is REMOVEd. With
 * `addUnreadCount` the counter moves by an atomic ADD instead of a SET.
 */
export function buildConversationUpdate(
  next: Conversation,
  fields: readonly ConversationMutableField[],
  opts: { addUnreadCount?: number } = {},
): ConversationUpdateExpression {
  const sets: string[] = [];
  const removes: string[] = [];
  const adds: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};

  const setOrRemove = (attr: string, value: unknown) => {
    names[`#${attr}`] = attr;
    if (value === undefined || value === null || value === '') {
      removes.push(`#${attr}`);
    } else {
      sets.push(`#${attr} = :${attr}`);
      values[`:${attr}`] = value;
    }
  };

  for (const field of new Set(fields)) {
    if (field === 'updatedAt') continue;
    if (field === 'unreadCount' && opts.addUnreadCount !== undefined) continue;
    setOrRemove(field, next[field]);
  }
  setOrRemove('updatedAt', next.updatedAt);

  const keys = conversationIndexKeys(next);
  for (const attr of CONVERSATION_INDEX_ATTRS) {
    setOrRemove(attr, keys[attr]);
  }

  if (opts.addUnreadCount !== undefined) {
    names['#unreadCount'] = 'unreadCount';
    values[':unreadInc'] = opts.addUnreadCount;
    adds.push('#unreadCount :unreadInc');
  }

  const expression =
    `SET ${sets.join(', ')}` +
    (removes.length ? ` REMOVE ${removes.join(', ')}` : '') +
    (adds.length ? ` ADD ${adds.join(', ')}` : '');

  return {
    UpdateExpression: expression,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
}

/** What the badge counters must move by for a conversation going `current` → `next`. */
export interface InboxCountersDelta {
  unreadConversations?: number;
  flaggedConversations?: number;
  unreadByKind?: Partial<Record<ConversationKind, number>>;
}

export function countersDelta(
  current: Conversation | undefined,
  next: Conversation,
): InboxCountersDelta | undefined {
  const wasUnread = current ? countsAsUnread(current) : false;
  const isUnread = countsAsUnread(next);
  const wasFlagged = current?.flagged === true;
  const isFlagged = next.flagged === true;

  const delta: InboxCountersDelta = {};
  const unread = Number(isUnread) - Number(wasUnread);
  if (unread !== 0) delta.unreadConversations = unread;

  const byKind: Partial<Record<ConversationKind, number>> = {};
  if (current && wasUnread) byKind[current.kind] = (byKind[current.kind] ?? 0) - 1;
  if (isUnread) byKind[next.kind] = (byKind[next.kind] ?? 0) + 1;
  for (const [kind, n] of Object.entries(byKind)) {
    if (n === 0) delete byKind[kind as ConversationKind];
  }
  if (Object.keys(byKind).length) delta.unreadByKind = byKind;

  const flagged = Number(isFlagged) - Number(wasFlagged);
  if (flagged !== 0) delta.flaggedConversations = flagged;

  return Object.keys(delta).length ? delta : undefined;
}
