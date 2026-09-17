import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import {
  CONVERSATION_STATES,
  type Conversation,
  type ConversationAddressPointer,
  type ConversationKind,
  type ConversationMember,
  type ConversationPointer,
  type ConversationPointerKind,
  type ConversationReadMarker,
  type ConversationState,
  type ConversationView,
} from '@bitcrm/types';
import {
  FLAG_CONVERSATION_GSI5PK,
  MEMBER_SK_PREFIX,
  MESSAGE_SK_PREFIX,
  MESSAGING_GSI1_NAME,
  MESSAGING_GSI2_NAME,
  MESSAGING_GSI3_NAME,
  MESSAGING_GSI5_NAME,
  MESSAGING_GSI6_NAME,
  MESSAGING_TABLE,
  METADATA_SK,
  READ_SK_PREFIX,
  accountCategoryGsi6Pk,
  addressPk,
  categoryGsi3Pk,
  conversationPk,
  convOfPk,
  inboxGsi1Pk,
  memberOfGsi3Pk,
  memberOfGsi3Sk,
  memberSk,
  readMarkerSk,
  unreadGsi2Pk,
} from '../common/constants/dynamo.constants';
import { InvalidCursorError, decodeCursor, encodeCursor } from '../common/cursor';
import { conditionFailedAt, duplicateKeyError, isConditionalCheckFailed } from '../common/dynamo-errors';
import { compact, stripKeys } from '../common/items';
import { walkYears, yearNow, type YearWalkCursor } from '../common/year-walk';
import { countersAddUpdate } from '../counters/inbox-counters.repository';
import {
  buildConversationUpdate,
  conversationItem,
  countersDelta,
  toConversation,
  type ConversationMutableField,
} from './conversation-keys';

/** The optimistic guard (`updatedAt` unchanged) failed: re-read and retry. */
export class StaleConversationError extends Error {
  constructor(public readonly conversationId: string) {
    super(`Conversation ${conversationId} changed underneath the update; re-read and retry`);
    this.name = 'StaleConversationError';
  }
}

/** The requested tab + filter combination has no index (§3.4 forbids FilterExpression). */
export class UnsupportedInboxFilterError extends Error {
  constructor(query: InboxQuery) {
    super(
      `Inbox view "${query.view}" cannot be combined with kind/categoryId — ` +
        'only view=all narrows by category (GSI3) or account category (GSI6)',
    );
    this.name = 'UnsupportedInboxFilterError';
  }
}

/** Fields a caller may change through `update()`; `null` clears an optional field. */
export interface ConversationPatch {
  state?: ConversationState;
  flagged?: boolean;
  unread?: boolean;
  categoryId?: string | null;
  assignedUserId?: string | null;
  needsResolution?: boolean | null;
  kind?: ConversationKind;
  partyKind?: Conversation['partyKind'];
  partyId?: string | null;
  addresses?: Conversation['addresses'];
  lastBusinessNumber?: string | null;
  chatbotActive?: boolean | null;
  placeholder?: boolean | null;
  /** Group name (§6); `null` clears it. */
  name?: string | null;
  /** Group membership copy on the header; the `MEMBER#` rows are written by `updateMembers`. */
  memberIds?: string[];
}

/** One `updateMembers` call: rows to add, user ids to remove, an optional rename. */
export interface MembershipChange {
  add?: ConversationMember[];
  remove?: string[];
  name?: string;
}

export interface InboxQuery {
  view: ConversationView;
  /** Category tab (Clients / Team / Unknown …); combines only with `view: 'all'`. */
  kind?: ConversationKind;
  /** Workiz account category (GSI6); combines only with `view: 'all'`. */
  categoryId?: string;
}

export interface ListOptions {
  limit: number;
  cursor?: string;
  /** Injectable clock for the year walk (tests). */
  now?: Date;
}

export interface ConversationPage {
  items: Conversation[];
  nextCursor?: string;
}

export interface FindOrCreateInput {
  /** The conversation to create if the party has none yet (id, timestamps set by the caller). */
  conversation: Conversation;
  /** The `CONVOF#<kind>#<id>` key that makes the create idempotent. */
  pointer: { kind: ConversationPointerKind; id: string };
  /** `ADDR#` rows to point at the new conversation (E.164 / lowercase email). */
  addresses?: Array<{ address: string; source: ConversationAddressPointer['source'] }>;
}

const isConversationState = (value: unknown): value is ConversationState =>
  typeof value === 'string' && (CONVERSATION_STATES as readonly string[]).includes(value);

/** Which GSI a listing reads and how its partition key is built. */
type IndexTarget =
  | { yearly: true; index: string; pkAttr: string; pkFor: (year: string) => string }
  | { yearly: false; index: string; pkAttr: string; pk: string };

/**
 * Applies a patch to a conversation, deriving the bookkeeping fields
 * (`archivedAt/By`, `flaggedAt/By`, `unreadCount`) and returning the list of
 * attributes that must be written. Exported for unit tests.
 */
export function applyPatch(
  current: Conversation,
  patch: ConversationPatch,
  actorId: string | undefined,
  at: string,
): { next: Conversation; fields: ConversationMutableField[] } {
  const next: Conversation = { ...current, updatedAt: at };
  const fields = new Set<ConversationMutableField>();
  const clear = <K extends ConversationMutableField>(key: K, value: Conversation[K] | null | undefined) => {
    next[key] = (value ?? undefined) as Conversation[K];
    fields.add(key);
  };

  if (patch.state !== undefined && patch.state !== current.state) {
    next.state = patch.state;
    fields.add('state');
    const archiving = patch.state === 'archived';
    clear('archivedAt', archiving ? at : undefined);
    clear('archivedBy', archiving ? actorId : undefined);
  }
  if (patch.flagged !== undefined && patch.flagged !== current.flagged) {
    next.flagged = patch.flagged;
    fields.add('flagged');
    clear('flaggedAt', patch.flagged ? at : undefined);
    clear('flaggedBy', patch.flagged ? actorId : undefined);
  }
  if (patch.unread !== undefined && patch.unread !== current.unread) {
    next.unread = patch.unread;
    fields.add('unread');
    if (!patch.unread) clear('unreadCount', 0);
  }
  if (patch.categoryId !== undefined) clear('categoryId', patch.categoryId);
  if (patch.assignedUserId !== undefined) clear('assignedUserId', patch.assignedUserId);
  if (patch.needsResolution !== undefined) clear('needsResolution', patch.needsResolution);
  if (patch.kind !== undefined && patch.kind !== current.kind) clear('kind', patch.kind);
  if (patch.partyKind !== undefined) clear('partyKind', patch.partyKind);
  if (patch.partyId !== undefined) clear('partyId', patch.partyId);
  if (patch.addresses !== undefined) clear('addresses', patch.addresses);
  if (patch.lastBusinessNumber !== undefined) clear('lastBusinessNumber', patch.lastBusinessNumber);
  if (patch.chatbotActive !== undefined) clear('chatbotActive', patch.chatbotActive);
  if (patch.placeholder !== undefined) clear('placeholder', patch.placeholder);
  if (patch.name !== undefined && patch.name !== current.name) clear('name', patch.name);
  if (patch.memberIds !== undefined && !sameIds(current.memberIds, patch.memberIds)) {
    clear('memberIds', patch.memberIds);
  }

  return { next, fields: [...fields] };
}

const sameIds = (a: string[] | undefined, b: string[]) =>
  (a ?? []).length === b.length && (a ?? []).every((id, i) => id === b[i]);

/** `countMessagesAfter` never reads past this many rows; the UI shows "99+". */
export const UNREAD_COUNT_CAP = 99;

/**
 * Conversations in the messaging table (design §3.2–3.5, §6):
 *
 *   CONV#<id>                / METADATA        the conversation; GSI1/2/3/5/6 keys
 *                                              derived by `conversationIndexKeys`;
 *                                              a `group` also carries `name`, `memberIds`
 *   CONV#<id>                / READ#<userId>   per-user read marker
 *   CONV#<id>                / MEMBER#<userId> group membership; GSI3 MEMBEROF#<userId>
 *                                              / <joinedAt>#<conversationId>
 *   CONVOF#<kind>#<partyId>  / METADATA        party → conversation (find-or-create guard);
 *                                              a group points at itself (CONVOF#group#<id>)
 *   ADDR#<e164|email>        / METADATA        address → conversation (inbound routing)
 *
 * Every write that changes `unread`/`flagged` also moves `INBOX#COUNTERS`
 * in the same transaction, guarded by the conversation's `updatedAt` so the
 * delta always accounts for a real transition. Listings are Query-only on
 * the year-bucketed indexes — no Scan, no FilterExpression (§3.4); the one
 * filter, in `countMessagesAfter`, only skips the handful of `READ#` rows
 * at the tail of a conversation partition.
 */
@Injectable()
export class ConversationsRepository {
  private readonly logger = new Logger(ConversationsRepository.name);
  private tableName = MESSAGING_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  // ---------------------------------------------------------------- writes

  /**
   * `Put CONV#<id>/METADATA` with `attribute_not_exists(PK)` — fails on a
   * duplicate id. A create adds the conversation to the category totals, so
   * the counters ADD rides in the same transaction as the Put.
   *
   * The duplicate-id failure is still a `ConditionalCheckFailedException`: in
   * a transaction DynamoDB reports it as a cancellation of item 0, and that is
   * translated back here so callers keep the contract they had when this was
   * a single `PutItem`.
   */
  async create(conversation: Conversation): Promise<void> {
    const Put = {
      TableName: this.tableName,
      Item: conversationItem(conversation),
      ConditionExpression: 'attribute_not_exists(PK)',
    };
    const counters = this.countersUpdate(undefined, conversation);
    try {
      if (counters) {
        await this.dynamoDb.client.send(
          new TransactWriteCommand({ TransactItems: [{ Put }, { Update: counters }] }),
        );
      } else {
        await this.dynamoDb.client.send(new PutCommand(Put));
      }
    } catch (err) {
      if (conditionFailedAt(err, 0)) throw duplicateKeyError(conversation.id);
      throw err;
    }
    this.logger.log(`Created conversation ${conversation.id} (${conversation.kind})`);
  }

  /**
   * Idempotent "the conversation for this party" (§3.3 A8/A9): reads
   * `CONVOF#<kind>#<id>`; on a miss, one TransactWriteItems puts the pointer
   * (`attribute_not_exists(PK)`), the conversation and any `ADDR#` rows. If
   * the pointer condition trips, another writer won the race — its
   * conversation is returned instead. Nothing is partially written.
   */
  async findOrCreate(input: FindOrCreateInput): Promise<{ conversation: Conversation; created: boolean }> {
    const { kind, id } = input.pointer;
    const existing = await this.getByParty(kind, id);
    if (existing) return { conversation: existing, created: false };

    const c = input.conversation;
    const pointer: ConversationPointer = {
      pointerKind: kind,
      pointerId: id,
      conversationId: c.id,
      createdAt: c.createdAt,
    };
    const counters = this.countersUpdate(undefined, c);
    const TransactItems = [
      {
        Put: {
          TableName: this.tableName,
          Item: { PK: convOfPk(kind, id), SK: METADATA_SK, ...pointer },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
      {
        Put: {
          TableName: this.tableName,
          Item: conversationItem(c),
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
      ...(input.addresses ?? []).map((a) => ({
        Put: {
          TableName: this.tableName,
          Item: this.addressItem({
            address: a.address,
            conversationId: c.id,
            partyKind: c.partyKind,
            partyId: c.partyId,
            source: a.source,
            updatedAt: c.createdAt,
          }),
        },
      })),
      // The new conversation joins the category totals. Last, so the pointer
      // stays at index 0 for the `conditionFailedAt(err, 0)` race check.
      ...(counters ? [{ Update: counters }] : []),
    ];

    try {
      await this.dynamoDb.client.send(new TransactWriteCommand({ TransactItems }));
      this.logger.log(`Created conversation ${c.id} for ${kind}#${id}`);
      return { conversation: c, created: true };
    } catch (err) {
      if (conditionFailedAt(err, 0)) {
        const raced = await this.getByParty(kind, id);
        if (raced) return { conversation: raced, created: false };
      }
      throw err;
    }
  }

  /**
   * `UpdateItem CONV#<id>` for archive / flag / mark-unread / recategorise /
   * assign / re-resolve party (§3.5): SET the changed fields, recompute every
   * GSI key (sparse ones REMOVEd), guarded by `updatedAt = current.updatedAt`.
   * When the change moves the unread or flagged badge, the counters ADD rides
   * in the same transaction. Returns the conversation as written.
   */
  async update(
    current: Conversation,
    patch: ConversationPatch,
    opts: { actorId?: string; at?: string } = {},
  ): Promise<Conversation> {
    const at = opts.at ?? new Date().toISOString();
    const { next, fields } = applyPatch(current, patch, opts.actorId, at);
    if (!fields.length) return current;

    const conversationUpdate = this.guardedUpdate(current, next, fields);
    const counters = this.countersUpdate(current, next);

    try {
      if (counters) {
        await this.dynamoDb.client.send(
          new TransactWriteCommand({
            TransactItems: [{ Update: conversationUpdate }, { Update: counters }],
          }),
        );
      } else {
        await this.dynamoDb.client.send(new UpdateCommand(conversationUpdate));
      }
    } catch (err) {
      if (isConditionalCheckFailed(err) || conditionFailedAt(err, 0)) {
        throw new StaleConversationError(current.id);
      }
      throw err;
    }
    return next;
  }

  /**
   * "Read" for the team (§7.1 `POST /conversations/:id/read`): one
   * transaction sets `unread=false, unreadCount=0` and drops the GSI2 key,
   * puts `READ#<userId>` with `lastReadAt` / `lastReadMessageSk`, and
   * decrements the unread counters when the conversation was counted.
   */
  async markRead(
    current: Conversation,
    userId: string,
    opts: { lastReadMessageSk?: string; at?: string } = {},
  ): Promise<Conversation> {
    const at = opts.at ?? new Date().toISOString();
    const next: Conversation = { ...current, unread: false, unreadCount: 0, updatedAt: at };
    const marker: ConversationReadMarker = {
      conversationId: current.id,
      userId,
      lastReadAt: at,
      lastReadMessageSk: opts.lastReadMessageSk,
    };
    const counters = this.countersUpdate(current, next);

    try {
      await this.dynamoDb.client.send(
        new TransactWriteCommand({
          TransactItems: [
            { Update: this.guardedUpdate(current, next, ['unread', 'unreadCount']) },
            {
              Put: {
                TableName: this.tableName,
                Item: {
                  PK: conversationPk(current.id),
                  SK: readMarkerSk(userId),
                  ...compact(marker as unknown as Record<string, unknown>),
                },
              },
            },
            ...(counters ? [{ Update: counters }] : []),
          ],
        }),
      );
    } catch (err) {
      if (conditionFailedAt(err, 0)) throw new StaleConversationError(current.id);
      throw err;
    }
    return next;
  }

  /** `Put ADDR#<address>/METADATA` — (re)points an address at a conversation. */
  async putAddressPointer(pointer: ConversationAddressPointer): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({ TableName: this.tableName, Item: this.addressItem(pointer) }),
    );
  }

  /** `Delete ADDR#<address>/METADATA` — e.g. a phone removed from a contact. */
  async removeAddressPointer(address: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: addressPk(address), SK: METADATA_SK },
      }),
    );
  }

  // ------------------------------------------------------- groups (§6)

  /**
   * A new `group` conversation in one TransactWriteItems: the self-pointer
   * `CONVOF#group#<id>` (so `by-party/group/:id` resolves like any party),
   * the header with `memberIds`, and one `MEMBER#` row per member. Every
   * Put is guarded by `attribute_not_exists(PK)`; a duplicate id fails whole.
   */
  async createGroup(conversation: Conversation, members: ConversationMember[]): Promise<Conversation> {
    const c: Conversation = { ...conversation, memberIds: members.map((m) => m.userId) };
    const pointer: ConversationPointer = {
      pointerKind: 'group',
      pointerId: c.id,
      conversationId: c.id,
      createdAt: c.createdAt,
    };
    const counters = this.countersUpdate(undefined, c);
    await this.dynamoDb.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: { PK: convOfPk('group', c.id), SK: METADATA_SK, ...pointer },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: conversationItem(c),
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          ...members.map((m) => ({ Put: { TableName: this.tableName, Item: this.memberItem(m) } })),
          // A group is a conversation like any other — it belongs in the Team total.
          ...(counters ? [{ Update: counters }] : []),
        ],
      }),
    );
    this.logger.log(`Created group ${c.id} with ${members.length} member(s)`);
    return c;
  }

  /**
   * Rename and/or change membership: the header (`memberIds`, `name`) is
   * updated under the `updatedAt` guard and the `MEMBER#` rows are put /
   * deleted in the same transaction, so the copy on the header can never
   * disagree with the rows. Returns the conversation as written.
   */
  async updateMembers(
    current: Conversation,
    change: MembershipChange,
    opts: { actorId?: string; at?: string } = {},
  ): Promise<Conversation> {
    const at = opts.at ?? new Date().toISOString();
    const have = current.memberIds ?? [];
    // Only real changes: an id already on the roster is not re-put (it would
    // reset `joinedAt`), one that is not there is not deleted.
    const add = (change.add ?? []).filter((m) => !have.includes(m.userId));
    const remove = (change.remove ?? []).filter((id) => have.includes(id));
    const memberIds = [...have.filter((id) => !remove.includes(id)), ...add.map((m) => m.userId)];
    const patch: ConversationPatch = { memberIds };
    if (change.name !== undefined) patch.name = change.name;
    const { next, fields } = applyPatch(current, patch, opts.actorId, at);
    if (!fields.length) return current;

    try {
      await this.dynamoDb.client.send(
        new TransactWriteCommand({
          TransactItems: [
            { Update: this.guardedUpdate(current, next, fields) },
            ...add.map((m) => ({ Put: { TableName: this.tableName, Item: this.memberItem(m) } })),
            ...remove.map((userId) => ({
              Delete: { TableName: this.tableName, Key: { PK: conversationPk(current.id), SK: memberSk(userId) } },
            })),
          ],
        }),
      );
    } catch (err) {
      if (conditionFailedAt(err, 0)) throw new StaleConversationError(current.id);
      throw err;
    }
    return next;
  }

  /** `GetItem CONV#<id>/MEMBER#<userId>`. */
  async getMember(conversationId: string, userId: string): Promise<ConversationMember | null> {
    const res = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: conversationPk(conversationId), SK: memberSk(userId) },
      }),
    );
    return res.Item ? stripKeys<ConversationMember>(res.Item) : null;
  }

  /** `Query PK = CONV#<id> AND begins_with(SK, 'MEMBER#')` — the roster, in user-id order. */
  async listMembers(conversationId: string): Promise<ConversationMember[]> {
    const items = await this.queryPartition(conversationId, MEMBER_SK_PREFIX);
    return items.map((item) => stripKeys<ConversationMember>(item));
  }

  /** `Query CategoryIndex GSI3PK = MEMBEROF#<userId>` — every group the user is in. */
  async listMemberOf(userId: string): Promise<ConversationMember[]> {
    const members: ConversationMember[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await this.queryIndex(MESSAGING_GSI3_NAME, 'GSI3PK', memberOfGsi3Pk(userId), startKey, 100);
      members.push(...page.items.map((item) => stripKeys<ConversationMember>(item)));
      startKey = page.lastEvaluatedKey;
    } while (startKey);
    return members;
  }

  // --------------------------------------------------- read markers (§6)

  /**
   * `Put CONV#<id>/READ#<userId>` alone — a member's own "read up to here",
   * which must not touch the team-wide `unread` flag (that flag is the
   * office's, cleared by `markRead`).
   */
  async putReadMarker(
    conversationId: string,
    userId: string,
    opts: { lastReadMessageSk?: string; at?: string } = {},
  ): Promise<ConversationReadMarker> {
    const marker: ConversationReadMarker = {
      conversationId,
      userId,
      lastReadAt: opts.at ?? new Date().toISOString(),
      lastReadMessageSk: opts.lastReadMessageSk,
    };
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: conversationPk(conversationId),
          SK: readMarkerSk(userId),
          ...compact(marker as unknown as Record<string, unknown>),
        },
      }),
    );
    return marker;
  }

  /** `Query PK = CONV#<id> AND begins_with(SK, 'READ#')` — who has read the thread, and up to where. */
  async listReadMarkers(conversationId: string): Promise<ConversationReadMarker[]> {
    const items = await this.queryPartition(conversationId, READ_SK_PREFIX);
    return items.map((item) => stripKeys<ConversationReadMarker>(item));
  }

  /**
   * How many messages sit after a read marker — the per-member unread
   * count of a team / group thread, capped at `UNREAD_COUNT_CAP`. With a
   * marker: `SK > :after` (key condition) plus `begins_with(SK, 'MSG#')`
   * to drop the `READ#` rows that sort after every message; without one:
   * `begins_with(SK, 'MSG#')` alone. `Select: COUNT`, so no item is returned.
   */
  async countMessagesAfter(
    conversationId: string,
    afterSk: string | undefined,
    cap: number = UNREAD_COUNT_CAP,
  ): Promise<number> {
    const res = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: afterSk ? 'PK = :pk AND SK > :after' : 'PK = :pk AND begins_with(SK, :prefix)',
        ...(afterSk ? { FilterExpression: 'begins_with(SK, :prefix)' } : {}),
        ExpressionAttributeValues: {
          ':pk': conversationPk(conversationId),
          ':prefix': MESSAGE_SK_PREFIX,
          ...(afterSk ? { ':after': afterSk } : {}),
        },
        Select: 'COUNT',
        Limit: cap,
      }),
    );
    return Math.min(res.Count ?? 0, cap);
  }

  // ----------------------------------------------------------------- reads

  /** `GetItem CONV#<id>/METADATA`. */
  async get(id: string): Promise<Conversation | null> {
    const res = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: conversationPk(id), SK: METADATA_SK },
      }),
    );
    return res.Item ? toConversation(res.Item) : null;
  }

  /** `GetItem CONVOF#<kind>#<id>/METADATA`. */
  async getPointer(kind: ConversationPointerKind, id: string): Promise<ConversationPointer | null> {
    const res = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: convOfPk(kind, id), SK: METADATA_SK },
      }),
    );
    return res.Item ? stripKeys<ConversationPointer>(res.Item) : null;
  }

  /** A8: `GetItem CONVOF#…` → `GetItem CONV#…` (two reads, no index). */
  async getByParty(kind: ConversationPointerKind, id: string): Promise<Conversation | null> {
    const pointer = await this.getPointer(kind, id);
    return pointer ? this.get(pointer.conversationId) : null;
  }

  /** A9: `GetItem ADDR#<e164|email>/METADATA` — the inbound routing hit. */
  async getByAddress(address: string): Promise<ConversationAddressPointer | null> {
    const res = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: addressPk(address), SK: METADATA_SK },
      }),
    );
    return res.Item ? stripKeys<ConversationAddressPointer>(res.Item) : null;
  }

  /** `GetItem CONV#<id>/READ#<userId>`. */
  async getReadMarker(conversationId: string, userId: string): Promise<ConversationReadMarker | null> {
    const res = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: conversationPk(conversationId), SK: readMarkerSk(userId) },
      }),
    );
    return res.Item ? stripKeys<ConversationReadMarker>(res.Item) : null;
  }

  /**
   * The inbox (§3.3 A1–A5), newest activity first, `limit` items per page:
   *
   *   all              GSI1 INBOX#open#<YYYY>          walks back year by year
   *   all + kind       GSI3 CAT#<kind>#<YYYY>          idem
   *   all + categoryId GSI6 ACCTCAT#<categoryId>#<YYYY> idem
   *   archived         GSI1 INBOX#archived#<YYYY>      idem
   *   unread           GSI2 UNREAD#<YYYY>              idem (sparse)
   *   flagged          GSI5 FLAG#conversation          one partition, no year
   *
   * The cursor is base64url JSON `{ y, k? }` (year + resume key) or `{ k }`
   * for the flagged partition. Key-condition-only queries — never a filter.
   */
  async listInbox(query: InboxQuery, opts: ListOptions): Promise<ConversationPage> {
    const target = this.resolveIndex(query);
    const raw = decodeCursor<{ y?: unknown; k?: unknown }>(opts.cursor);

    if (!target.yearly) {
      if (raw && (raw.k === undefined || typeof raw.k !== 'object')) throw new InvalidCursorError();
      const page = await this.queryIndex(
        target.index,
        target.pkAttr,
        target.pk,
        raw?.k as Record<string, unknown> | undefined,
        opts.limit,
      );
      return {
        items: page.items.map(toConversation),
        nextCursor: page.lastEvaluatedKey ? encodeCursor({ k: page.lastEvaluatedKey }) : undefined,
      };
    }

    if (raw && typeof raw.y !== 'string') throw new InvalidCursorError();
    const walked = await walkYears<Record<string, unknown>>({
      startYear: yearNow(opts.now),
      limit: opts.limit,
      cursor: raw as YearWalkCursor | undefined,
      query: (year, startKey, n) =>
        this.queryIndex(target.index, target.pkAttr, target.pkFor(year), startKey, n),
    });
    return {
      items: walked.items.map(toConversation),
      nextCursor: walked.nextCursor ? encodeCursor(walked.nextCursor) : undefined,
    };
  }

  /**
   * Every conversation, for the search backfill (design §7.1
   * `GET /conversations/internal/all`, §7.4): the open partitions
   * `INBOX#open#<YYYY>` newest year first, then the archived ones
   * `INBOX#archived#<YYYY>` — the same InboxIndex walk the inbox does, and
   * still no Scan (§3.4). One page may straddle the open → archived boundary.
   * The cursor is base64url JSON `{ s, y, k? }`: the state being read, the
   * year, and the resume key when DynamoDB stopped mid-partition.
   */
  async listAll(opts: ListOptions): Promise<ConversationPage> {
    const raw = decodeCursor<{ s?: unknown; y?: unknown; k?: unknown }>(opts.cursor);
    if (raw && (!isConversationState(raw.s) || typeof raw.y !== 'string')) throw new InvalidCursorError();
    if (raw && raw.k !== undefined && (typeof raw.k !== 'object' || raw.k === null)) throw new InvalidCursorError();

    const startYear = yearNow(opts.now);
    let state: ConversationState = raw ? (raw.s as ConversationState) : 'open';
    let cursor: YearWalkCursor | undefined = raw
      ? { y: raw.y as string, k: raw.k as Record<string, unknown> | undefined }
      : undefined;
    const items: Record<string, unknown>[] = [];

    for (;;) {
      const pk = (year: string) => inboxGsi1Pk(state, year);
      const walked = await walkYears<Record<string, unknown>>({
        startYear,
        limit: opts.limit - items.length,
        cursor,
        query: (year, startKey, n) => this.queryIndex(MESSAGING_GSI1_NAME, 'GSI1PK', pk(year), startKey, n),
      });
      items.push(...walked.items);
      if (walked.nextCursor) {
        return {
          items: items.map(toConversation),
          nextCursor: encodeCursor({ s: state, ...walked.nextCursor }),
        };
      }
      // This state's partitions are exhausted.
      if (state === 'archived') return { items: items.map(toConversation) };
      state = 'archived';
      cursor = undefined;
      if (items.length >= opts.limit) {
        return { items: items.map(toConversation), nextCursor: encodeCursor({ s: state, y: startYear }) };
      }
    }
  }

  // -------------------------------------------------------------- internals

  private resolveIndex(query: InboxQuery): IndexTarget {
    const narrowed = query.kind !== undefined || query.categoryId !== undefined;
    if (narrowed && query.view !== 'all') throw new UnsupportedInboxFilterError(query);
    if (query.kind !== undefined && query.categoryId !== undefined) {
      throw new UnsupportedInboxFilterError(query);
    }

    switch (query.view) {
      case 'flagged':
        return { yearly: false, index: MESSAGING_GSI5_NAME, pkAttr: 'GSI5PK', pk: FLAG_CONVERSATION_GSI5PK };
      case 'unread':
        return { yearly: true, index: MESSAGING_GSI2_NAME, pkAttr: 'GSI2PK', pkFor: unreadGsi2Pk };
      case 'archived':
        return {
          yearly: true,
          index: MESSAGING_GSI1_NAME,
          pkAttr: 'GSI1PK',
          pkFor: (y) => inboxGsi1Pk('archived', y),
        };
      case 'all':
      default: {
        const kind = query.kind;
        if (kind !== undefined) {
          return { yearly: true, index: MESSAGING_GSI3_NAME, pkAttr: 'GSI3PK', pkFor: (y) => categoryGsi3Pk(kind, y) };
        }
        const categoryId = query.categoryId;
        if (categoryId !== undefined) {
          return {
            yearly: true,
            index: MESSAGING_GSI6_NAME,
            pkAttr: 'GSI6PK',
            pkFor: (y) => accountCategoryGsi6Pk(categoryId, y),
          };
        }
        return { yearly: true, index: MESSAGING_GSI1_NAME, pkAttr: 'GSI1PK', pkFor: (y) => inboxGsi1Pk('open', y) };
      }
    }
  }

  private async queryIndex(
    index: string,
    pkAttr: string,
    pk: string,
    exclusiveStartKey: Record<string, unknown> | undefined,
    limit: number,
  ): Promise<{ items: Record<string, unknown>[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const res = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: index,
        KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeNames: { '#pk': pkAttr },
        ExpressionAttributeValues: { ':pk': pk },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    return { items: res.Items ?? [], lastEvaluatedKey: res.LastEvaluatedKey };
  }

  /**
   * The counters `Update` for a conversation going `current` → `next`
   * (`current: undefined` is a create), or `undefined` when nothing moved.
   * Every write path funnels through here so the badge and the category
   * totals can never be maintained by two different rules.
   */
  private countersUpdate(current: Conversation | undefined, next: Conversation) {
    const delta = countersDelta(current, next);
    return delta ? countersAddUpdate(this.tableName, delta) : undefined;
  }

  /** The conversation Update body with the optimistic `updatedAt` guard. */
  private guardedUpdate(
    current: Conversation,
    next: Conversation,
    fields: readonly ConversationMutableField[],
  ) {
    const expr = buildConversationUpdate(next, fields);
    return {
      TableName: this.tableName,
      Key: { PK: conversationPk(current.id), SK: METADATA_SK },
      UpdateExpression: expr.UpdateExpression,
      ConditionExpression: 'attribute_exists(PK) AND #updatedAt = :expectedUpdatedAt',
      ExpressionAttributeNames: expr.ExpressionAttributeNames,
      ExpressionAttributeValues: {
        ...expr.ExpressionAttributeValues,
        ':expectedUpdatedAt': current.updatedAt,
      },
    };
  }

  private addressItem(pointer: ConversationAddressPointer): Record<string, unknown> {
    return {
      PK: addressPk(pointer.address),
      SK: METADATA_SK,
      ...compact(pointer as unknown as Record<string, unknown>),
    };
  }

  /** `CONV#<id>` / `MEMBER#<userId>` + the MEMBEROF# adjacency on GSI3. */
  private memberItem(m: ConversationMember): Record<string, unknown> {
    return {
      PK: conversationPk(m.conversationId),
      SK: memberSk(m.userId),
      ...compact(m as unknown as Record<string, unknown>),
      GSI3PK: memberOfGsi3Pk(m.userId),
      GSI3SK: memberOfGsi3Sk(m.joinedAt, m.conversationId),
    };
  }

  /** Every row of one conversation partition under a sort-key prefix (`MEMBER#`, `READ#`). */
  private async queryPartition(conversationId: string, prefix: string): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: { ':pk': conversationPk(conversationId), ':prefix': prefix },
          ExclusiveStartKey: startKey,
        }),
      );
      items.push(...(res.Items ?? []));
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return items;
  }
}
