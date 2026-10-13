import { Injectable } from '@nestjs/common';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { CALLS_TABLE } from '../common/constants/dynamo.constants';

/**
 * How many calls each month of the log holds — what an unfiltered or
 * date-only `GET /calls/count` reads instead of walking years of partitions.
 *
 *   PK=CALLCOUNT, SK=MONTH#<YYYY-MM>   { count }   ADDed when a call first
 *                                                  enters the log (−1 when a
 *                                                  counted row turns out to be
 *                                                  a hidden internal leg)
 *   PK=CALLCOUNT, SK=STATE             { readyAt } stamped by `recount:calls`;
 *                                                  until then nothing reads
 *                                                  the counters
 *
 * One partition on purpose: ~140 small rows read with one range Query. The
 * write rate is the call rate (one ADD per new call), far below a
 * partition's ceiling — this is not the CALL#ALL problem, which was every
 * call ROW in one partition. No GSI keys, so never in the log. The month is
 * the UTC month of `startedAt`, the same as the log's `CALL#<YYYY-MM>`.
 */
export const CALL_COUNTERS_PK = 'CALLCOUNT';
export const callCounterSk = (month: string) => `MONTH#${month}`;
export const CALL_COUNTERS_STATE_SK = 'STATE';

/** The last instant of a `YYYY-MM` month, ISO (UTC). */
function lastInstantOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1) - 1).toISOString();
}

/**
 * Whether a list window (`dateFrom` / `dateTo` as the log reads them — ISO
 * instants or prefixes, `dateTo` inclusive of everything it prefixes) covers
 * every call of `month`, so its counter can stand in for a walk.
 */
export function monthFullyCovered(month: string, dateFrom?: string, dateTo?: string): boolean {
  if (dateFrom && dateFrom > `${month}-01T00:00:00.000Z`) return false;
  if (dateTo) {
    const last = lastInstantOf(month);
    // A prefix of the last instant reaches it (`2026-09-30`, `2026-09`);
    // otherwise the bound has to sort after it.
    if (!last.startsWith(dateTo) && dateTo < last) return false;
  }
  return true;
}

@Injectable()
export class CallCountersRepository {
  private readonly tableName = CALLS_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  async bump(month: string, delta: number): Promise<void> {
    await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: CALL_COUNTERS_PK, SK: callCounterSk(month) },
        UpdateExpression: 'ADD #count :d',
        ExpressionAttributeNames: { '#count': 'count' },
        ExpressionAttributeValues: { ':d': delta },
      }),
    );
  }

  /** The counters of `first`..`last` (inclusive `YYYY-MM`); months without a row are absent. */
  async months(first: string, last: string): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND SK BETWEEN :lo AND :hi',
          ExpressionAttributeValues: {
            ':pk': CALL_COUNTERS_PK,
            ':lo': callCounterSk(first),
            ':hi': callCounterSk(last),
          },
          ...(startKey && { ExclusiveStartKey: startKey }),
        }),
      );
      for (const item of res.Items ?? []) {
        const sk = item.SK as string;
        if (typeof sk === 'string' && sk.startsWith('MONTH#') && typeof item.count === 'number') {
          out.set(sk.slice('MONTH#'.length), item.count);
        }
      }
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return out;
  }

  /** True once `recount:calls --apply` has set every month from the log. */
  async ready(): Promise<boolean> {
    const res = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: CALL_COUNTERS_PK, SK: CALL_COUNTERS_STATE_SK },
      }),
    );
    return !!res?.Item?.readyAt;
  }

  /** Recount only: set a month to an absolute value. */
  async setMonth(month: string, count: number): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { PK: CALL_COUNTERS_PK, SK: callCounterSk(month), count, recountedAt: new Date().toISOString() },
      }),
    );
  }

  /** Recount only: from now on the counters are trusted. */
  async markReady(): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { PK: CALL_COUNTERS_PK, SK: CALL_COUNTERS_STATE_SK, readyAt: new Date().toISOString() },
      }),
    );
  }
}
