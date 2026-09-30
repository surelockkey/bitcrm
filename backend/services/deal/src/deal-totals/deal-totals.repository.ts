import { Injectable } from '@nestjs/common';
import { BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { DEALS_TABLE } from '../common/constants/dynamo.constants';

/** DynamoDB's BatchGetItem ceiling. */
const BATCH = 100;
/** Throttled keys come back as UnprocessedKeys; retried this many times with backoff. */
const RETRIES = 5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A job's total, read off its `DEAL#<id>/METADATA` row — `totals.total`, the
 * number the job page and the reports show, else Workiz's `jobTotalPrice` on
 * an imported row that has no totals yet.
 */
export function dealTotalOf(item: Record<string, unknown>): number {
  const totals = item.totals as { total?: unknown } | undefined;
  if (typeof totals?.total === 'number' && Number.isFinite(totals.total)) return totals.total;
  if (typeof item.jobTotalPrice === 'number' && Number.isFinite(item.jobTotalPrice)) return item.jobTotalPrice;
  return 0;
}

/**
 * Totals of many jobs in one call — what Call Tracking's Revenue sums. Reads
 * only the three attributes it needs (BatchGet by key, projected), 100 keys a
 * request, throttled keys retried.
 */
@Injectable()
export class DealTotalsRepository {
  private readonly tableName = DEALS_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  async totalsOf(ids: string[]): Promise<Record<string, number>> {
    const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id))];
    const out: Record<string, number> = {};
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += BATCH) chunks.push(unique.slice(i, i + BATCH));

    await Promise.all(
      chunks.map(async (chunk) => {
        let keys: Record<string, unknown>[] = chunk.map((id) => ({ PK: `DEAL#${id}`, SK: 'METADATA' }));
        for (let attempt = 0; keys.length && attempt <= RETRIES; attempt += 1) {
          if (attempt) await sleep(50 * 2 ** attempt);
          const res = await this.dynamoDb.client.send(
            new BatchGetCommand({
              RequestItems: {
                [this.tableName]: {
                  Keys: keys,
                  ProjectionExpression: '#id, #totals, #jobTotalPrice',
                  ExpressionAttributeNames: {
                    '#id': 'id',
                    '#totals': 'totals',
                    '#jobTotalPrice': 'jobTotalPrice',
                  },
                },
              },
            }),
          );
          for (const item of res.Responses?.[this.tableName] ?? []) {
            if (typeof item.id === 'string') out[item.id] = dealTotalOf(item);
          }
          keys = (res.UnprocessedKeys?.[this.tableName]?.Keys ?? []) as Record<string, unknown>[];
        }
        if (keys.length) throw new Error(`${keys.length} deal totals left unread after ${RETRIES} retries`);
      }),
    );
    return out;
  }
}
