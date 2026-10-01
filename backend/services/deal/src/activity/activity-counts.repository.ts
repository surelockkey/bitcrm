import { Injectable, Logger } from '@nestjs/common';
import { BatchGetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { DEALS_TABLE } from '../common/constants/dynamo.constants';
import { activityCountKey } from './activity.constants';

/**
 * Events per account day (`ACTCOUNT#<day>` / `COUNT`) — the "of N" of an
 * unfiltered Activity page without counting a month of rows on every load.
 * The timeline writer adds one per event; the backfill sets them exact.
 */
@Injectable()
export class ActivityCountsRepository {
  private readonly logger = new Logger(ActivityCountsRepository.name);
  private readonly tableName = DEALS_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  /** Best effort: a missed tick costs one in a total, never the event. */
  async add(day: string, delta: number): Promise<void> {
    try {
      await this.dynamoDb.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: activityCountKey(day),
          UpdateExpression: 'ADD #count :d',
          ExpressionAttributeNames: { '#count': 'count' },
          ExpressionAttributeValues: { ':d': delta },
        }),
      );
    } catch (err) {
      this.logger.warn(`Activity count for ${day} not moved by ${delta}: ${(err as Error).message}`);
    }
  }

  /** Σ of the days' counters; a day with no counter holds nothing. */
  async sum(days: string[]): Promise<number> {
    let total = 0;
    const chunks: string[][] = [];
    for (let i = 0; i < days.length; i += 100) chunks.push(days.slice(i, i + 100));
    await Promise.all(
      chunks.map(async (chunk) => {
        let keys: Record<string, unknown>[] = chunk.map(activityCountKey);
        for (let attempt = 0; keys.length && attempt < 5; attempt += 1) {
          const res = await this.dynamoDb.client.send(
            new BatchGetCommand({ RequestItems: { [this.tableName]: { Keys: keys } } }),
          );
          for (const item of res.Responses?.[this.tableName] ?? []) {
            if (typeof item.count === 'number') total += item.count;
          }
          keys = (res.UnprocessedKeys?.[this.tableName]?.Keys ?? []) as Record<string, unknown>[];
        }
      }),
    );
    return total;
  }
}
