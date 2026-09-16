import { Injectable } from '@nestjs/common';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import {
  CONVERSATION_KINDS,
  EMPTY_INBOX_COUNTERS,
  type ConversationKind,
  type InboxCounters,
  type InboxTotals,
} from '@bitcrm/types';
import { COUNTERS_PK, MESSAGING_TABLE, METADATA_SK } from '../common/constants/dynamo.constants';
import { type InboxCountersDelta } from '../conversations/conversation-keys';

export type { InboxCountersDelta } from '../conversations/conversation-keys';

/** Per-kind counters are flat attributes so an ADD never hits a missing map path. */
const kindAttr = (kind: ConversationKind) => `unreadKind_${kind}`;
/** The same, for the per-category totals. */
const totalKindAttr = (kind: ConversationKind) => `totalKind_${kind}`;

/**
 * Set by `setTotals` (the recount) and by a `set` that carries totals. Until
 * it is there the `total*` attributes are NOT reported: a counters row that
 * predates totals, or a table filled by the Workiz history loader, has only
 * whatever the live ADDs have added since — a number far below the truth.
 * Better no number than a wrong one (the reader falls back to what it loaded).
 */
const TOTALS_RECOUNTED_AT = 'totalsRecountedAt';

/**
 * The `ADD` that moves the badge counters by `delta`, as a TransactWriteItems
 * `Update` body — the conversations and messages repositories include it in
 * the same transaction as the state change it accounts for (§3.5).
 * `undefined` when the delta is empty.
 */
export function countersAddUpdate(
  tableName: string,
  delta: InboxCountersDelta,
): {
  TableName: string;
  Key: Record<string, string>;
  UpdateExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, number>;
} | undefined {
  const adds: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, number> = {};

  const add = (attr: string, n: number | undefined, placeholder: string) => {
    if (!n) return;
    names[`#${placeholder}`] = attr;
    values[`:${placeholder}`] = n;
    adds.push(`#${placeholder} :${placeholder}`);
  };

  add('unreadConversations', delta.unreadConversations, 'unread');
  add('flaggedConversations', delta.flaggedConversations, 'flagged');
  for (const [kind, n] of Object.entries(delta.unreadByKind ?? {})) {
    add(kindAttr(kind as ConversationKind), n, `kind_${kind}`);
  }
  add('totalConversations', delta.totalConversations, 'total');
  add('archivedConversations', delta.archivedConversations, 'archived');
  for (const [kind, n] of Object.entries(delta.totalByKind ?? {})) {
    add(totalKindAttr(kind as ConversationKind), n, `totalkind_${kind}`);
  }
  if (!adds.length) return undefined;

  return {
    TableName: tableName,
    Key: { PK: COUNTERS_PK, SK: METADATA_SK },
    UpdateExpression: `ADD ${adds.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
}

/**
 * One item, `INBOX#COUNTERS` / `METADATA`, moved with atomic ADDs so the
 * header badge never counts the inbox (design §3.2, §3.4: ≤ 1 write/s in
 * practice against a 1 000 WCU/s partition ceiling). The import does not
 * touch it — `set()` writes the recount once at the end, and `setTotals()`
 * rebuilds only the category sizes (`POST /internal/counters/recount`).
 */
@Injectable()
export class InboxCountersRepository {
  private tableName = MESSAGING_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  /** `GetItem INBOX#COUNTERS`; zeros when the item was never written. */
  async get(): Promise<InboxCounters> {
    const res = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: COUNTERS_PK, SK: METADATA_SK },
      }),
    );
    if (!res.Item) return { ...EMPTY_INBOX_COUNTERS, unreadByKind: {} };
    const unreadByKind: Partial<Record<ConversationKind, number>> = {};
    for (const kind of CONVERSATION_KINDS) {
      const n = Number(res.Item[kindAttr(kind)] ?? 0);
      if (n) unreadByKind[kind] = n;
    }
    const counters: InboxCounters = {
      unreadConversations: Number(res.Item.unreadConversations ?? 0),
      flaggedConversations: Number(res.Item.flaggedConversations ?? 0),
      unreadByKind,
    };

    // Totals only once they have been rebuilt at least once — see the note
    // on TOTALS_RECOUNTED_AT. Absent means "unknown", never zero.
    const recountedAt = res.Item[TOTALS_RECOUNTED_AT];
    if (typeof recountedAt === 'string' && recountedAt) {
      const totalByKind: Partial<Record<ConversationKind, number>> = {};
      for (const kind of CONVERSATION_KINDS) {
        const n = Number(res.Item[totalKindAttr(kind)] ?? 0);
        if (n) totalByKind[kind] = n;
      }
      counters.totalConversations = Number(res.Item.totalConversations ?? 0);
      counters.totalByKind = totalByKind;
      counters.archivedConversations = Number(res.Item.archivedConversations ?? 0);
      counters.totalsRecountedAt = recountedAt;
    }
    return counters;
  }

  /** `UpdateItem INBOX#COUNTERS ADD …` — creates the item on first use. */
  async add(delta: InboxCountersDelta): Promise<void> {
    const update = countersAddUpdate(this.tableName, delta);
    if (!update) return;
    await this.dynamoDb.client.send(new UpdateCommand(update));
  }

  /**
   * `PutItem INBOX#COUNTERS` — the post-import recount; replaces every
   * counter. Totals are written (and marked recounted) only when `counters`
   * carries them, so a caller that knows the unread numbers alone does not
   * publish a totals figure it never counted.
   */
  async set(counters: InboxCounters, at: string = new Date().toISOString()): Promise<void> {
    const item: Record<string, unknown> = {
      PK: COUNTERS_PK,
      SK: METADATA_SK,
      unreadConversations: counters.unreadConversations,
      flaggedConversations: counters.flaggedConversations,
      updatedAt: at,
    };
    for (const kind of CONVERSATION_KINDS) {
      item[kindAttr(kind)] = counters.unreadByKind[kind] ?? 0;
    }
    if (counters.totalConversations !== undefined) {
      item.totalConversations = counters.totalConversations;
      item.archivedConversations = counters.archivedConversations ?? 0;
      for (const kind of CONVERSATION_KINDS) {
        item[totalKindAttr(kind)] = counters.totalByKind?.[kind] ?? 0;
      }
      item[TOTALS_RECOUNTED_AT] = counters.totalsRecountedAt ?? at;
    }
    await this.dynamoDb.client.send(new PutCommand({ TableName: this.tableName, Item: item }));
  }

  /**
   * `UpdateItem INBOX#COUNTERS SET total*` — the totals recount. A SET, not a
   * Put: the unread and flagged badge numbers, which this call never counted,
   * must survive it untouched. Writing `totalsRecountedAt` is what makes the
   * totals visible to `get()`.
   */
  async setTotals(totals: InboxTotals, at: string = new Date().toISOString()): Promise<void> {
    const names: Record<string, string> = {
      '#total': 'totalConversations',
      '#archived': 'archivedConversations',
      '#recountedAt': TOTALS_RECOUNTED_AT,
      '#updatedAt': 'updatedAt',
    };
    const values: Record<string, unknown> = {
      ':total': totals.totalConversations,
      ':archived': totals.archivedConversations,
      ':recountedAt': at,
      ':updatedAt': at,
    };
    const sets = ['#total = :total', '#archived = :archived', '#recountedAt = :recountedAt', '#updatedAt = :updatedAt'];
    for (const kind of CONVERSATION_KINDS) {
      names[`#totalkind_${kind}`] = totalKindAttr(kind);
      values[`:totalkind_${kind}`] = totals.totalByKind[kind] ?? 0;
      sets.push(`#totalkind_${kind} = :totalkind_${kind}`);
    }
    await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: COUNTERS_PK, SK: METADATA_SK },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  }
}
