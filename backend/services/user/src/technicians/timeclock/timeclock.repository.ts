import { Injectable } from '@nestjs/common';
import {
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
  clockSk,
} from '../constants/dynamo.constants';
import { toRangeStart, toRangeEnd } from '../date-range.util';

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
