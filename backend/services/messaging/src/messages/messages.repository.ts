import { Injectable, Logger } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import {
  MESSAGE_PREVIEW_LENGTH,
  MESSAGE_STATUS_RANK,
  type Conversation,
  type Message,
  type MessageAttachment,
  type MessageStatus,
} from '@bitcrm/types';
import {
  CLIENT_MESSAGE_TTL_SECONDS,
  MESSAGE_SK_PREFIX,
  MESSAGING_GSI4_NAME,
  MESSAGING_GSI5_NAME,
  MESSAGING_TABLE,
  METADATA_SK,
  clientMessagePk,
  conversationPk,
  flagMessageGsi5Pk,
  jobGsi4Pk,
  messageIndexSk,
  messageSk,
  providerSidPk,
  yearOf,
} from '../common/constants/dynamo.constants';
import { InvalidCursorError, decodeCursor, encodeCursor } from '../common/cursor';
import { conditionFailedAt, isConditionalCheckFailed } from '../common/dynamo-errors';
import { compact, epochSeconds, stripKeys } from '../common/items';
import { walkYears, yearNow, type YearWalkCursor } from '../common/year-walk';
import { countersAddUpdate } from '../counters/inbox-counters.repository';
import {
  buildConversationUpdate,
  countersDelta,
  toConversation,
  type ConversationMutableField,
} from '../conversations/conversation-keys';
import { StaleConversationError } from '../conversations/conversations.repository';

export interface MessageKey {
  conversationId: string;
  createdAt: string;
  messageId: string;
}

export interface MessagePage {
  items: Message[];
  nextCursor?: string;
}

/** `PSID#<providerSid>` / METADATA. */
export interface ProviderSidPointer {
  providerSid: string;
  conversationId: string;
  messageSk: string;
  createdAt: string;
}

/** `CLIENTMSG#<clientMessageId>` / METADATA, expires after 7 days. */
export interface ClientMessagePointer {
  clientMessageId: string;
  conversationId: string;
  messageSk: string;
  createdBy: string;
  createdAt: string;
  /** Epoch seconds (DynamoDB TTL). */
  expiresAt: number;
}

export interface AppendInboundInput {
  message: Message;
  /** The conversation as last read — its `updatedAt` guards the transaction. */
  conversation: Conversation;
  at?: string;
}

export interface AppendOutboundInput {
  message: Message;
  clientMessageId: string;
  createdBy: string;
  conversation: Conversation;
  at?: string;
  /**
   * Also bump the team-wide `unread` (+ counters), as an inbound does: an
   * in-app line the employee writes on their own team thread is news for
   * the office, even though it was composed in BitCRM (design §6).
   */
  markUnread?: boolean;
}

export interface AppendResult {
  /** The PSID# / CLIENTMSG# guard tripped: nothing was written. */
  duplicate: boolean;
  /** The conversation as it is after the append (or as passed in, on a duplicate). */
  conversation: Conversation;
  /** On an outbound duplicate, where the first submit landed. */
  existing?: ClientMessagePointer;
}

export interface StatusUpdate {
  status: MessageStatus;
  at?: string;
  errorCode?: string;
  errorMessage?: string;
  /** When given, the update also requires the stored sid to match (or be absent). */
  providerSid?: string;
  segments?: number;
  sentAt?: string;
  deliveredAt?: string;
}

const LAST_MESSAGE_FIELDS: readonly ConversationMutableField[] = [
  'lastMessageAt',
  'lastMessageId',
  'lastMessagePreview',
  'lastChannel',
  'lastDirection',
  'lastBusinessNumber',
  'lastDealId',
];

/** How many times an append re-reads the conversation after a stale guard. */
const MAX_ATTEMPTS = 3;

/** What the inbox row shows under the party name. */
export function messagePreview(m: Message): string | undefined {
  const text = m.body?.trim() || m.subject?.trim() || (m.attachments?.length ? '[attachment]' : '');
  return text ? text.slice(0, MESSAGE_PREVIEW_LENGTH) : undefined;
}

/**
 * Full item for a Put: `CONV#<conversationId>` / `MSG#<createdAt>#<id>`,
 * `statusRank` for the status-callback guard, GSI4 when job-linked, GSI5
 * when flagged (design §3.2).
 */
export function messageItem(m: Message): Record<string, unknown> {
  const sk = messageIndexSk(m.createdAt, m.id);
  return {
    PK: conversationPk(m.conversationId),
    SK: messageSk(m.createdAt, m.id),
    ...compact(m as unknown as Record<string, unknown>),
    statusRank: MESSAGE_STATUS_RANK[m.status],
    ...(m.dealId ? { GSI4PK: jobGsi4Pk(m.dealId), GSI4SK: sk } : {}),
    ...(m.flagged ? { GSI5PK: flagMessageGsi5Pk(yearOf(m.createdAt)), GSI5SK: sk } : {}),
  };
}

export function toMessage(item: Record<string, unknown>): Message {
  return stripKeys<Message>(item, ['statusRank']);
}

/**
 * The conversation after `m` lands on it: `last*` roll forward only when the
 * message is not older than the current last one (a reconciliation or import
 * inserting history must not rewind the inbox), `unread` bumps for inbound.
 */
export function rollForward(
  current: Conversation,
  m: Message,
  at: string,
  opts: { markUnread: boolean },
): Conversation {
  const next: Conversation = { ...current, updatedAt: at };
  const newer = !current.lastMessageAt || m.createdAt >= current.lastMessageAt;
  if (newer) {
    next.lastMessageAt = m.createdAt;
    next.lastMessageId = m.id;
    next.lastMessagePreview = messagePreview(m);
    next.lastChannel = m.channel;
    next.lastDirection = m.direction;
    if (m.businessNumber) next.lastBusinessNumber = m.businessNumber;
    if (m.dealId) next.lastDealId = m.dealId;
  }
  if (opts.markUnread) {
    next.unread = true;
    next.unreadCount = (current.unreadCount ?? 0) + 1;
  }
  return next;
}

/**
 * Messages and their service pointers (design §3.2, §3.5, §4.9):
 *
 *   CONV#<conversationId>  / MSG#<createdAt>#<messageId>   the line (GSI4 JOB#, GSI5 FLAG#message#YYYY)
 *   PSID#<providerSid>     / METADATA                       webhook / reconciliation dedup
 *   CLIENTMSG#<uuid>       / METADATA                       double-submit guard (TTL 7 d)
 *
 * Appends are single TransactWriteItems that also roll the conversation's
 * `last*` / `unread` forward and move INBOX#COUNTERS; the conversation
 * update is guarded by `updatedAt` and retried from a fresh read when a
 * concurrent write (flag, archive, another message) got in first. Feeds
 * page inside the conversation partition; there is no global message index.
 */
@Injectable()
export class MessagesRepository {
  private readonly logger = new Logger(MessagesRepository.name);
  private tableName = MESSAGING_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  // --------------------------------------------------------------- appends

  /**
   * Inbound (§3.5): TransactWriteItems [
   *   Put PSID#<providerSid>          attribute_not_exists(PK)  → duplicate webhook cancels everything
   *   Put CONV#…/MSG#…                attribute_not_exists(PK)
   *   Update CONV#…/METADATA          last*, unread=true, ADD unreadCount 1, GSI1–3/5/6 rewritten
   *                                   for the year of lastMessageAt; guard updatedAt
   *   Update INBOX#COUNTERS           ADD unreadConversations 1 (+ per kind) — only when the
   *                                   conversation was not already counted as unread ]
   * Returns `duplicate: true` (nothing written) when the sid was seen before.
   */
  async appendInbound(input: AppendInboundInput): Promise<AppendResult> {
    const { message } = input;
    if (!message.providerSid) {
      throw new Error('appendInbound requires message.providerSid (PSID# deduplication)');
    }
    const at = input.at ?? new Date().toISOString();
    let current = input.conversation;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const next = rollForward(current, message, at, { markUnread: true });
      const delta = countersDelta(current, next);
      const counters = delta ? countersAddUpdate(this.tableName, delta) : undefined;
      const TransactItems = [
        {
          Put: {
            TableName: this.tableName,
            Item: this.providerSidItem(message.providerSid, message),
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: this.tableName,
            Item: messageItem(message),
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Update: this.guardedConversationUpdate(current, next, [...LAST_MESSAGE_FIELDS, 'unread'], {
            addUnreadCount: 1,
          }),
        },
        ...(counters ? [{ Update: counters }] : []),
      ];

      try {
        await this.dynamoDb.client.send(new TransactWriteCommand({ TransactItems }));
        return { duplicate: false, conversation: next };
      } catch (err) {
        if (conditionFailedAt(err, 0)) {
          this.logger.log(`Duplicate inbound ${message.providerSid} ignored`);
          return { duplicate: true, conversation: current };
        }
        if (conditionFailedAt(err, 2) && attempt < MAX_ATTEMPTS) {
          const fresh = await this.readConversation(current.id);
          if (!fresh) throw err;
          current = fresh;
          continue;
        }
        throw err;
      }
    }
    throw new StaleConversationError(current.id);
  }

  /**
   * Outbound (§3.5, §4.4): TransactWriteItems [
   *   Put CLIENTMSG#<clientMessageId>  attribute_not_exists(PK), expiresAt = now + 7 d
   *   Put CONV#…/MSG#…                 attribute_not_exists(PK)   (status queued)
   *   Update CONV#…/METADATA           last*, lastBusinessNumber; guard updatedAt
   *   (markUnread) …                   + unread=true, ADD unreadCount 1, and the
   *   Update INBOX#COUNTERS            counters move — the inbound shape (§6) ]
   * A repeated submit returns `duplicate: true` plus the pointer to the first one.
   */
  async appendOutbound(input: AppendOutboundInput): Promise<AppendResult> {
    const { message } = input;
    const at = input.at ?? new Date().toISOString();
    const markUnread = input.markUnread === true;
    let current = input.conversation;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const next = rollForward(current, message, at, { markUnread });
      const delta = markUnread ? countersDelta(current, next) : undefined;
      const counters = delta ? countersAddUpdate(this.tableName, delta) : undefined;
      const TransactItems = [
        {
          Put: {
            TableName: this.tableName,
            Item: this.clientMessageItem(input.clientMessageId, message, input.createdBy, at),
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: this.tableName,
            Item: messageItem(message),
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Update: markUnread
            ? this.guardedConversationUpdate(current, next, [...LAST_MESSAGE_FIELDS, 'unread'], { addUnreadCount: 1 })
            : this.guardedConversationUpdate(current, next, LAST_MESSAGE_FIELDS),
        },
        ...(counters ? [{ Update: counters }] : []),
      ];

      try {
        await this.dynamoDb.client.send(new TransactWriteCommand({ TransactItems }));
        return { duplicate: false, conversation: next };
      } catch (err) {
        if (conditionFailedAt(err, 0)) {
          const existing = await this.getClientMessagePointer(input.clientMessageId);
          return { duplicate: true, conversation: current, existing: existing ?? undefined };
        }
        if (conditionFailedAt(err, 2) && attempt < MAX_ATTEMPTS) {
          const fresh = await this.readConversation(current.id);
          if (!fresh) throw err;
          current = fresh;
          continue;
        }
        throw err;
      }
    }
    throw new StaleConversationError(current.id);
  }

  // --------------------------------------------------------------- updates

  /**
   * Status callback (§3.5, §4.5): `UpdateItem` guarded by the monotonic rank —
   * `attribute_not_exists(statusRank) OR statusRank < :rank` — so callbacks
   * arriving out of order and terminal-after-terminal are ignored, and, when
   * `providerSid` is given, by `providerSid = :sid` (or absent, first callback).
   * Returns whether the write applied.
   */
  async updateStatus(key: MessageKey, input: StatusUpdate): Promise<boolean> {
    const at = input.at ?? new Date().toISOString();
    const rank = MESSAGE_STATUS_RANK[input.status];
    const sets = ['#status = :status', '#statusRank = :rank', '#updatedAt = :at'];
    const names: Record<string, string> = {
      '#status': 'status',
      '#statusRank': 'statusRank',
      '#updatedAt': 'updatedAt',
    };
    const values: Record<string, unknown> = { ':status': input.status, ':rank': rank, ':at': at };

    const optional: Array<[string, unknown]> = [
      ['errorCode', input.errorCode],
      ['errorMessage', input.errorMessage],
      ['providerSid', input.providerSid],
      ['segments', input.segments],
      ['sentAt', input.sentAt ?? (input.status === 'sent' ? at : undefined)],
      ['deliveredAt', input.deliveredAt ?? (input.status === 'delivered' ? at : undefined)],
    ];
    for (const [field, value] of optional) {
      if (value === undefined || value === null || value === '') continue;
      sets.push(`#${field} = :${field}`);
      names[`#${field}`] = field;
      values[`:${field}`] = value;
    }

    const conditions = [
      'attribute_exists(PK)',
      '(attribute_not_exists(#statusRank) OR #statusRank < :rank)',
    ];
    if (input.providerSid) {
      conditions.push('(attribute_not_exists(#providerSid) OR #providerSid = :providerSid)');
    }

    try {
      await this.dynamoDb.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: this.key(key),
          UpdateExpression: `SET ${sets.join(', ')}`,
          ConditionExpression: conditions.join(' AND '),
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw err;
    }
  }

  /**
   * Outbound worker claim (§4.4): `status = queued AND attribute_not_exists(providerSid)
   * AND attribute_not_exists(sendingStartedAt)` → `sending` + `sendingStartedAt`.
   * `false` means another attempt already called the provider — reconcile
   * with `messages.list` before sending again (M9).
   */
  async markSending(key: MessageKey, at: string = new Date().toISOString()): Promise<boolean> {
    try {
      await this.dynamoDb.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: this.key(key),
          UpdateExpression:
            'SET #status = :sending, #statusRank = :rank, #sendingStartedAt = :at, #updatedAt = :at',
          ConditionExpression:
            'attribute_exists(PK) AND #status = :queued AND attribute_not_exists(#providerSid) AND attribute_not_exists(#sendingStartedAt)',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#statusRank': 'statusRank',
            '#sendingStartedAt': 'sendingStartedAt',
            '#updatedAt': 'updatedAt',
            '#providerSid': 'providerSid',
          },
          ExpressionAttributeValues: {
            ':sending': 'sending',
            ':queued': 'queued',
            ':rank': MESSAGE_STATUS_RANK.sending,
            ':at': at,
          },
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw err;
    }
  }

  /**
   * `PATCH /conversations/:id/messages/:messageId { flagged }`: SET flagged +
   * GSI5 `FLAG#message#<YYYY>` / `<createdAt>#<id>`, or REMOVE all four (§3.5).
   */
  async setFlagged(
    key: MessageKey,
    flagged: boolean,
    actorId: string,
    at: string = new Date().toISOString(),
  ): Promise<void> {
    const names: Record<string, string> = {
      '#flagged': 'flagged',
      '#flaggedAt': 'flaggedAt',
      '#flaggedBy': 'flaggedBy',
      '#updatedAt': 'updatedAt',
      '#GSI5PK': 'GSI5PK',
      '#GSI5SK': 'GSI5SK',
    };
    const values: Record<string, unknown> = { ':flagged': flagged, ':at': at };
    let expression: string;
    if (flagged) {
      values[':by'] = actorId;
      values[':gsi5pk'] = flagMessageGsi5Pk(yearOf(key.createdAt));
      values[':gsi5sk'] = messageIndexSk(key.createdAt, key.messageId);
      expression =
        'SET #flagged = :flagged, #flaggedAt = :at, #flaggedBy = :by, #updatedAt = :at, #GSI5PK = :gsi5pk, #GSI5SK = :gsi5sk';
    } else {
      expression = 'SET #flagged = :flagged, #updatedAt = :at REMOVE #flaggedAt, #flaggedBy, #GSI5PK, #GSI5SK';
    }
    await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: this.key(key),
        UpdateExpression: expression,
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  }

  /**
   * `Put PSID#<sid>` with `attribute_not_exists(PK)` once the provider has
   * accepted an outbound message (M9). `false` when the sid is already
   * pointed somewhere — the caller decides whether that is the same message.
   */
  async putProviderSidPointer(
    providerSid: string,
    key: MessageKey,
    at: string = new Date().toISOString(),
  ): Promise<boolean> {
    try {
      await this.dynamoDb.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: providerSidPk(providerSid),
            SK: METADATA_SK,
            providerSid,
            conversationId: key.conversationId,
            messageSk: messageSk(key.createdAt, key.messageId),
            createdAt: at,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw err;
    }
  }

  /**
   * The media worker's write (§4.6): `GetItem` to find the attachment's
   * position, then `UpdateItem SET #attachments[i].#status = …, …` guarded by
   * `#attachments[i].#id = :attachmentId` so a concurrent rewrite of the list
   * cannot make the index land on a different file. Rewrites only the given
   * fields of that one element — never the whole list. `false` when the
   * message or the attachment is not there (or moved).
   */
  async updateAttachment(
    key: MessageKey,
    attachmentId: string,
    patch: Partial<Pick<MessageAttachment, 'status' | 's3Key' | 'size' | 'fileName' | 'contentType'>>,
    at: string = new Date().toISOString(),
  ): Promise<boolean> {
    const message = await this.get(key);
    const index = message?.attachments?.findIndex((a) => a.id === attachmentId) ?? -1;
    if (index < 0) return false;

    const sets = ['#updatedAt = :at'];
    const names: Record<string, string> = {
      '#attachments': 'attachments',
      '#id': 'id',
      '#updatedAt': 'updatedAt',
    };
    const values: Record<string, unknown> = { ':attachmentId': attachmentId, ':at': at };
    for (const [field, value] of Object.entries(patch)) {
      if (value === undefined || value === null || value === '') continue;
      names[`#${field}`] = field;
      values[`:${field}`] = value;
      sets.push(`#attachments[${index}].#${field} = :${field}`);
    }

    try {
      await this.dynamoDb.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: this.key(key),
          UpdateExpression: `SET ${sets.join(', ')}`,
          ConditionExpression: `attribute_exists(PK) AND #attachments[${index}].#id = :attachmentId`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw err;
    }
  }

  // ----------------------------------------------------------------- reads

  /** `GetItem CONV#<conversationId>/MSG#<createdAt>#<messageId>`. */
  async get(key: MessageKey): Promise<Message | null> {
    return this.getBySk(key.conversationId, messageSk(key.createdAt, key.messageId));
  }

  /** `GetItem` by the raw sort key (what the pointers store). */
  async getBySk(conversationId: string, sk: string): Promise<Message | null> {
    const res = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: conversationPk(conversationId), SK: sk },
      }),
    );
    return res.Item ? toMessage(res.Item) : null;
  }

  /** `GetItem PSID#<sid>/METADATA` — A10 fallback and reconciliation (M8). */
  async getProviderSidPointer(providerSid: string): Promise<ProviderSidPointer | null> {
    const res = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: providerSidPk(providerSid), SK: METADATA_SK },
      }),
    );
    return res.Item ? stripKeys<ProviderSidPointer>(res.Item) : null;
  }

  /** `GetItem PSID#…` → `GetItem CONV#…/MSG#…`. */
  async getByProviderSid(providerSid: string): Promise<Message | null> {
    const pointer = await this.getProviderSidPointer(providerSid);
    return pointer ? this.getBySk(pointer.conversationId, pointer.messageSk) : null;
  }

  /** `GetItem CLIENTMSG#<clientMessageId>/METADATA`. */
  async getClientMessagePointer(clientMessageId: string): Promise<ClientMessagePointer | null> {
    const res = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: clientMessagePk(clientMessageId), SK: METADATA_SK },
      }),
    );
    return res.Item ? stripKeys<ClientMessagePointer>(res.Item) : null;
  }

  /**
   * The feed (A6): `Query PK = CONV#<id> AND begins_with(SK, 'MSG#')`,
   * newest first, `limit` per page; the cursor (`{ k }`) is "load older".
   */
  async listByConversation(
    conversationId: string,
    opts: { limit: number; cursor?: string },
  ): Promise<MessagePage> {
    const raw = decodeCursor<{ k?: unknown }>(opts.cursor);
    if (raw && (raw.k === undefined || typeof raw.k !== 'object')) throw new InvalidCursorError();
    const res = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': conversationPk(conversationId), ':prefix': MESSAGE_SK_PREFIX },
        ScanIndexForward: false,
        Limit: opts.limit,
        ExclusiveStartKey: raw?.k as Record<string, unknown> | undefined,
      }),
    );
    return {
      items: (res.Items ?? []).map(toMessage),
      nextCursor: res.LastEvaluatedKey ? encodeCursor({ k: res.LastEvaluatedKey }) : undefined,
    };
  }

  /** The job tab (A7): `Query JobIndex GSI4PK = JOB#<dealId>`, newest first. */
  async listByJob(dealId: string, opts: { limit: number; cursor?: string }): Promise<MessagePage> {
    const raw = decodeCursor<{ k?: unknown }>(opts.cursor);
    if (raw && (raw.k === undefined || typeof raw.k !== 'object')) throw new InvalidCursorError();
    const res = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: MESSAGING_GSI4_NAME,
        KeyConditionExpression: 'GSI4PK = :pk',
        ExpressionAttributeValues: { ':pk': jobGsi4Pk(dealId) },
        ScanIndexForward: false,
        Limit: opts.limit,
        ExclusiveStartKey: raw?.k as Record<string, unknown> | undefined,
      }),
    );
    return {
      items: (res.Items ?? []).map(toMessage),
      nextCursor: res.LastEvaluatedKey ? encodeCursor({ k: res.LastEvaluatedKey }) : undefined,
    };
  }

  /**
   * Flagged messages (A3): `Query FlagIndex GSI5PK = FLAG#message#<YYYY>`,
   * walking back a year at a time like the inbox; cursor `{ y, k? }`.
   */
  async listFlagged(opts: { limit: number; cursor?: string; now?: Date }): Promise<MessagePage> {
    const raw = decodeCursor<{ y?: unknown; k?: unknown }>(opts.cursor);
    if (raw && typeof raw.y !== 'string') throw new InvalidCursorError();
    const walked = await walkYears<Record<string, unknown>>({
      startYear: yearNow(opts.now),
      limit: opts.limit,
      cursor: raw as YearWalkCursor | undefined,
      query: async (year, startKey, n) => {
        const res = await this.dynamoDb.client.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: MESSAGING_GSI5_NAME,
            KeyConditionExpression: 'GSI5PK = :pk',
            ExpressionAttributeValues: { ':pk': flagMessageGsi5Pk(year) },
            ScanIndexForward: false,
            Limit: n,
            ExclusiveStartKey: startKey,
          }),
        );
        return { items: res.Items ?? [], lastEvaluatedKey: res.LastEvaluatedKey };
      },
    });
    return {
      items: walked.items.map(toMessage),
      nextCursor: walked.nextCursor ? encodeCursor(walked.nextCursor) : undefined,
    };
  }

  // -------------------------------------------------------------- internals

  private key(key: MessageKey) {
    return { PK: conversationPk(key.conversationId), SK: messageSk(key.createdAt, key.messageId) };
  }

  private providerSidItem(providerSid: string, m: Message): Record<string, unknown> {
    const pointer: ProviderSidPointer = {
      providerSid,
      conversationId: m.conversationId,
      messageSk: messageSk(m.createdAt, m.id),
      createdAt: m.createdAt,
    };
    return { PK: providerSidPk(providerSid), SK: METADATA_SK, ...pointer };
  }

  private clientMessageItem(
    clientMessageId: string,
    m: Message,
    createdBy: string,
    at: string,
  ): Record<string, unknown> {
    const pointer: ClientMessagePointer = {
      clientMessageId,
      conversationId: m.conversationId,
      messageSk: messageSk(m.createdAt, m.id),
      createdBy,
      createdAt: at,
      expiresAt: epochSeconds(at) + CLIENT_MESSAGE_TTL_SECONDS,
    };
    return { PK: clientMessagePk(clientMessageId), SK: METADATA_SK, ...pointer };
  }

  private guardedConversationUpdate(
    current: Conversation,
    next: Conversation,
    fields: readonly ConversationMutableField[],
    opts: { addUnreadCount?: number } = {},
  ) {
    const expr = buildConversationUpdate(next, fields, opts);
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

  private async readConversation(id: string): Promise<Conversation | null> {
    const res = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: conversationPk(id), SK: METADATA_SK },
      }),
    );
    return res.Item ? toConversation(res.Item) : null;
  }
}
