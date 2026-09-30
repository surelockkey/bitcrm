import { Injectable } from '@nestjs/common';
import {
  BatchGetCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type TimeClockEntry, type TimeClockLocation } from '@bitcrm/types';
import {
  TECHNICIANS_TABLE,
  CLOCK_SK_PREFIX,
  CLOCK_OPEN_SK,
  GSI6_NAME,
  PROFILE_SK,
  clockSk,
  timeClockIndexPk,
} from '../constants/dynamo.constants';
import { toRangeStart, toRangeEnd } from '../date-range.util';
import { timeClockIndexKeys } from './timeclock-index';

/** BatchGetItem takes at most 100 keys a call. */
const BATCH_GET_MAX = 100;
/** How often unprocessed keys of one batch are asked again before giving up. */
const BATCH_GET_ATTEMPTS = 5;

/** A person's name fields, as the report prints them. */
export interface TimeClockPerson {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

/** Thrown when the open-entry pointer already exists — i.e. a second start. */
export class ClockAlreadyOpenError extends Error {
  constructor() {
    super('A time-clock entry is already open for this user');
    this.name = 'ClockAlreadyOpenError';
  }
}

/**
 * Thrown when the slot no longer holds this entry by the time the close lands —
 * i.e. somebody else already closed it. That is the ordinary shape of a
 * double-tapped Stop on a slow connection, and of an outbox redelivering a stop
 * whose reply was lost, so it must read as "already stopped" rather than as a
 * server fault.
 */
export class ClockAlreadyClosedError extends Error {
  constructor() {
    super('This time-clock entry is no longer the open one');
    this.name = 'ClockAlreadyClosedError';
  }
}

@Injectable()
export class TimeClockRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  private entryKey(userId: string, startedAt: string, id: string) {
    return { PK: `USER#${userId}`, SK: clockSk(startedAt, id) };
  }

  private openKey(userId: string) {
    return { PK: `USER#${userId}`, SK: CLOCK_OPEN_SK };
  }

  /**
   * Write the entry and claim the user's single open-entry slot, atomically.
   *
   * The claim is a conditional Put on one fixed sort key, so two phones racing
   * (or one phone's outbox retrying) cannot both win: DynamoDB rejects the
   * whole transaction and the caller is told which entry is already running,
   * rather than a second shift being opened behind the technician's back.
   */
  async createOpen(entry: TimeClockEntry): Promise<void> {
    try {
      await this.dynamoDb.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: TECHNICIANS_TABLE,
                Item: {
                  ...this.entryKey(entry.userId, entry.startedAt, entry.id),
                  // Only the history item goes into the report's index — the
                  // open slot below must not, or a running shift shows twice.
                  ...timeClockIndexKeys(entry),
                  ...entry,
                },
              },
            },
            {
              Put: {
                TableName: TECHNICIANS_TABLE,
                Item: { ...this.openKey(entry.userId), ...entry },
                ConditionExpression: 'attribute_not_exists(SK)',
              },
            },
          ],
        }),
      );
    } catch (error) {
      if (isTransactionConflict(error)) throw new ClockAlreadyOpenError();
      throw error;
    }
  }

  /** The running entry for a user, or null. One GetItem. */
  async getOpen(userId: string): Promise<TimeClockEntry | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({ TableName: TECHNICIANS_TABLE, Key: this.openKey(userId) }),
    );
    return result.Item ? toEntry(result.Item) : null;
  }

  /**
   * Close the running entry: stamp the history item and release the slot.
   *
   * Both halves move together, and the slot is released under the condition
   * that it still holds THIS entry — so a stop racing another stop closes the
   * shift exactly once. The loser of that race gets `ClockAlreadyClosedError`,
   * not the raw cancellation: a second tap on a slow connection is an ordinary
   * event on a doorstep, and it must not read as a 500.
   */
  async close(
    entry: TimeClockEntry,
    patch: { endedAt: string; minutes: number; endLocation?: TimeClockLocation },
  ): Promise<TimeClockEntry> {
    const closed: TimeClockEntry = {
      ...entry,
      endedAt: patch.endedAt,
      minutes: patch.minutes,
      ...(patch.endLocation ? { endLocation: patch.endLocation } : {}),
      updatedAt: patch.endedAt,
    };

    try {
      await this.dynamoDb.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: TECHNICIANS_TABLE,
                Key: this.entryKey(entry.userId, entry.startedAt, entry.id),
                UpdateExpression: patch.endLocation
                  ? 'SET endedAt = :e, #m = :m, endLocation = :loc, updatedAt = :u'
                  : 'SET endedAt = :e, #m = :m, updatedAt = :u',
                ExpressionAttributeNames: { '#m': 'minutes' },
                ExpressionAttributeValues: {
                  ':e': patch.endedAt,
                  ':m': patch.minutes,
                  ':u': patch.endedAt,
                  ...(patch.endLocation ? { ':loc': patch.endLocation } : {}),
                },
                ConditionExpression: 'attribute_exists(SK)',
              },
            },
            {
              Delete: {
                TableName: TECHNICIANS_TABLE,
                Key: this.openKey(entry.userId),
                ConditionExpression: '#id = :id',
                ExpressionAttributeNames: { '#id': 'id' },
                ExpressionAttributeValues: { ':id': entry.id },
              },
            },
          ],
        }),
      );
    } catch (error) {
      if (isTransactionConflict(error)) throw new ClockAlreadyClosedError();
      throw error;
    }

    return closed;
  }

  /**
   * Entries that STARTED inside [from, to]. Oldest first, which is the order a
   * timesheet is read in.
   */
  async listByUserInRange(
    userId: string,
    from: string,
    to: string,
  ): Promise<TimeClockEntry[]> {
    const lo = `${CLOCK_SK_PREFIX}${toRangeStart(from)}`;
    // '~' sorts after every '<instant>#<uuid>' sharing that instant's prefix.
    const hi = `${CLOCK_SK_PREFIX}${toRangeEnd(to)}~`;

    const items: Record<string, unknown>[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const result = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: TECHNICIANS_TABLE,
          KeyConditionExpression: 'PK = :pk AND SK BETWEEN :lo AND :hi',
          ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':lo': lo, ':hi': hi },
          ExclusiveStartKey: cursor,
        }),
      );
      items.push(...(result.Items || []));
      cursor = result.LastEvaluatedKey;
    } while (cursor);

    return items.map(toEntry);
  }

  /**
   * The person's labor cost per hour, to snapshot onto a new entry. One
   * GetItem on the technician profile; null when there is no profile or no
   * rate — office staff have neither, and their hours then cost nothing, as a
   * Workiz user with an empty labor cost does.
   */
  async getLaborRate(userId: string): Promise<number | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: TECHNICIANS_TABLE,
        Key: { PK: `USER#${userId}`, SK: PROFILE_SK },
        ProjectionExpression: 'laborCostPerHour',
      }),
    );
    const rate = result.Item?.laborCostPerHour;
    return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : null;
  }

  /**
   * Everyone's entries that STARTED in [fromInstant, toInstant) and fall in the
   * account month `month` — one Query on the TimeClockIndex partition of that
   * month, paged to the end. Oldest first.
   *
   * Bounds are instants, not days: the caller turns account days into the
   * instants they begin at. The upper bound is exclusive because the sort key
   * is `<startedAt>#<id>`: `BETWEEN lo AND hi` stops just before any entry
   * that started exactly at `hi`.
   */
  async listStartedBetween(
    month: string,
    fromInstant: string,
    toInstantExclusive: string,
  ): Promise<TimeClockEntry[]> {
    const items: Record<string, unknown>[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const result = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: TECHNICIANS_TABLE,
          IndexName: GSI6_NAME,
          KeyConditionExpression: 'GSI6PK = :pk AND GSI6SK BETWEEN :lo AND :hi',
          ExpressionAttributeValues: {
            ':pk': timeClockIndexPk(month),
            ':lo': fromInstant,
            ':hi': toInstantExclusive,
          },
          ExclusiveStartKey: cursor,
        }),
      );
      items.push(...(result.Items || []));
      cursor = result.LastEvaluatedKey;
    } while (cursor);
    return items.map(toEntry);
  }

  /** Name fields of these people (METADATA items). Missing people are absent from the map. */
  async peopleByIds(userIds: string[]): Promise<Map<string, TimeClockPerson>> {
    const rows = await this.batchGet(
      userIds.map((id) => ({ PK: `USER#${id}`, SK: 'METADATA' })),
      ['id', 'firstName', 'lastName', 'email'],
    );
    const out = new Map<string, TimeClockPerson>();
    for (const r of rows) {
      const id = r.id as string | undefined;
      if (!id) continue;
      out.set(id, {
        id,
        firstName: r.firstName as string | undefined,
        lastName: r.lastName as string | undefined,
        email: r.email as string | undefined,
      });
    }
    return out;
  }

  /** Which of these people have a running clock right now (the `CLOCK_OPEN` slot exists). */
  async openUserIds(userIds: string[]): Promise<Set<string>> {
    const rows = await this.batchGet(
      userIds.map((id) => ({ PK: `USER#${id}`, SK: CLOCK_OPEN_SK })),
      ['PK'],
    );
    return new Set(rows.map((r) => String(r.PK).slice('USER#'.length)));
  }

  /** BatchGetItem in chunks of 100, asking again for what DynamoDB left unprocessed. */
  private async batchGet(
    keys: { PK: string; SK: string }[],
    attributes: string[],
  ): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    // Names, not bare words: a projection must not trip over a reserved word.
    const names = Object.fromEntries(attributes.map((a, i) => [`#a${i}`, a]));
    const projection = Object.keys(names).join(', ');
    const unique = [...new Map(keys.map((k) => [`${k.PK}|${k.SK}`, k])).values()];
    for (let i = 0; i < unique.length; i += BATCH_GET_MAX) {
      let pending: Record<string, unknown>[] = unique.slice(i, i + BATCH_GET_MAX);
      for (let attempt = 0; pending.length && attempt < BATCH_GET_ATTEMPTS; attempt++) {
        const result = await this.dynamoDb.client.send(
          new BatchGetCommand({
            RequestItems: {
              [TECHNICIANS_TABLE]: {
                Keys: pending,
                ProjectionExpression: projection,
                ExpressionAttributeNames: names,
              },
            },
          }),
        );
        out.push(...((result.Responses?.[TECHNICIANS_TABLE] as Record<string, unknown>[]) || []));
        pending = (result.UnprocessedKeys?.[TECHNICIANS_TABLE]?.Keys as Record<string, unknown>[]) || [];
      }
      if (pending.length) {
        throw new Error(`BatchGet left ${pending.length} keys unprocessed`);
      }
    }
    return out;
  }
}

function toEntry(item: Record<string, unknown>): TimeClockEntry {
  return {
    id: item.id as string,
    userId: item.userId as string,
    startedAt: item.startedAt as string,
    endedAt: item.endedAt as string | undefined,
    minutes: item.minutes as number | undefined,
    dealId: item.dealId as string | undefined,
    startLocation: item.startLocation as TimeClockEntry['startLocation'],
    endLocation: item.endLocation as TimeClockEntry['endLocation'],
    source: item.source as TimeClockEntry['source'],
    ...(typeof item.laborCostPerHour === 'number'
      ? { laborCostPerHour: item.laborCostPerHour }
      : {}),
    ...(typeof item.notes === 'string' && item.notes ? { notes: item.notes } : {}),
    ...(typeof item.externalId === 'string' ? { externalId: item.externalId } : {}),
    createdAt: item.createdAt as string,
    updatedAt: item.updatedAt as string,
  };
}

/**
 * A rejected TransactWriteItems reports each item's reason in
 * `CancellationReasons`; the SDK also flattens the names into the message. Both
 * are checked because DynamoDB Local and the real service differ in which they
 * populate.
 */
function isTransactionConflict(error: unknown): boolean {
  const e = error as {
    name?: string;
    CancellationReasons?: { Code?: string }[];
    message?: string;
  };
  if (e?.name === 'ConditionalCheckFailedException') return true;
  if (e?.name !== 'TransactionCanceledException') return false;
  if (e.CancellationReasons?.some((r) => r?.Code === 'ConditionalCheckFailed')) {
    return true;
  }
  return Boolean(e.message?.includes('ConditionalCheckFailed'));
}
