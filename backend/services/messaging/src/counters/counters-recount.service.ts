import { Injectable, Logger } from '@nestjs/common';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { CONVERSATION_KINDS, type ConversationKind, type InboxTotals } from '@bitcrm/types';
import {
  INBOX_MIN_YEAR,
  MESSAGING_GSI1_NAME,
  MESSAGING_GSI3_NAME,
  MESSAGING_TABLE,
  categoryGsi3Pk,
  inboxGsi1Pk,
} from '../common/constants/dynamo.constants';
import { yearNow } from '../common/year-walk';
import { InboxCountersRepository } from './inbox-counters.repository';

export interface RecountResult extends InboxTotals {
  /** When the totals were written — what `get()` reports as `totalsRecountedAt`. */
  recountedAt: string;
  /** Index partitions counted (years × (2 states + 5 kinds)). */
  partitions: number;
  /** `Query … Select: COUNT` round trips, including the extra page of a partition over 1 MB. */
  queries: number;
  /** Read capacity the recount actually consumed, as DynamoDB reported it. */
  consumedRcu: number;
  seconds: number;
}

/**
 * Rebuilds the Inbox category totals by counting the index partitions
 * (`POST /api/messaging/internal/counters/recount`).
 *
 * The live totals are maintained by the transactional ADDs in
 * `ConversationsRepository`, which only ever see conversations the service
 * itself writes. Rows imported straight into DynamoDB by the Workiz loader
 * never passed through it, so after an import the counters item knows
 * nothing about the 42 657 conversations that are actually there. This
 * recount is what makes the column right, and it is what the operator runs
 * once the load finishes.
 *
 * What it counts, all key-condition-only Queries with `Select: 'COUNT'` —
 * no Scan, no FilterExpression, and no item bodies come back over the wire:
 *
 *   totalConversations    GSI1 INBOX#open#<YYYY>       summed over the years
 *   archivedConversations GSI1 INBOX#archived#<YYYY>   summed over the years
 *   totalByKind[kind]     GSI3 CAT#<kind>#<YYYY>       summed over the years
 *
 * GSI3 is sparse over open conversations only (`conversationIndexKeys`), so
 * the per-kind numbers and `totalConversations` count the same population
 * and the parts add up to the whole.
 *
 * COST. `Select: 'COUNT'` still charges for the index data traversed:
 * ~0.5 RCU per 4 KB of index entries (eventually consistent). Conversation
 * entries in these indexes are small — key attributes plus the projection —
 * so 42 657 open conversations is on the order of 10 MB of index, about
 * 1 300 RCU, well under a cent, and a few seconds of wall clock. The walk
 * issues years × 7 queries (about 80 for a decade of history) plus one more
 * per megabyte of partition. Run it after an import, and after any bulk
 * write that bypassed the service; it is not a cron job.
 *
 * IDEMPOTENT. It derives every number from the table and SETs the result —
 * running it twice in a row writes the same values, and running it while the
 * inbox is live simply re-bases the totals on the moment it read them. It is
 * a SET of the `total*` attributes only: the unread and flagged badge
 * numbers, which this endpoint never counts, are left exactly as they are.
 */
@Injectable()
export class CountersRecountService {
  private readonly logger = new Logger(CountersRecountService.name);
  private tableName = MESSAGING_TABLE;

  constructor(
    private readonly dynamoDb: DynamoDbService,
    private readonly counters: InboxCountersRepository,
  ) {}

  async recount(opts: { now?: Date; minYear?: number } = {}): Promise<RecountResult> {
    const startedAt = Date.now();
    const startYear = Number(yearNow(opts.now));
    const minYear = opts.minYear ?? INBOX_MIN_YEAR;
    const stats = { partitions: 0, queries: 0, consumedRcu: 0 };

    const totalByKind: Partial<Record<ConversationKind, number>> = {};
    let totalConversations = 0;
    let archivedConversations = 0;

    for (let year = startYear; year >= minYear; year--) {
      const y = String(year);
      totalConversations += await this.countPartition(
        MESSAGING_GSI1_NAME,
        'GSI1PK',
        inboxGsi1Pk('open', y),
        stats,
      );
      archivedConversations += await this.countPartition(
        MESSAGING_GSI1_NAME,
        'GSI1PK',
        inboxGsi1Pk('archived', y),
        stats,
      );
      for (const kind of CONVERSATION_KINDS) {
        const n = await this.countPartition(
          MESSAGING_GSI3_NAME,
          'GSI3PK',
          categoryGsi3Pk(kind, y),
          stats,
        );
        if (n) totalByKind[kind] = (totalByKind[kind] ?? 0) + n;
      }
    }

    const totals: InboxTotals = { totalConversations, totalByKind, archivedConversations };
    const recountedAt = new Date().toISOString();
    await this.counters.setTotals(totals, recountedAt);

    const result: RecountResult = {
      ...totals,
      recountedAt,
      ...stats,
      seconds: Math.round((Date.now() - startedAt) / 100) / 10,
    };
    this.logger.log(
      `Recounted inbox totals: ${totalConversations} open, ${archivedConversations} archived ` +
        `(${stats.queries} COUNT queries, ~${Math.round(stats.consumedRcu)} RCU, ${result.seconds}s)`,
    );
    return result;
  }

  /**
   * One index partition, `Select: 'COUNT'`, following `LastEvaluatedKey` —
   * DynamoDB stops a COUNT at 1 MB of traversed data, so a big year needs
   * more than one round trip to reach its real total.
   */
  private async countPartition(
    index: string,
    pkAttr: string,
    pk: string,
    stats: { partitions: number; queries: number; consumedRcu: number },
  ): Promise<number> {
    stats.partitions += 1;
    let count = 0;
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: index,
          KeyConditionExpression: '#pk = :pk',
          ExpressionAttributeNames: { '#pk': pkAttr },
          ExpressionAttributeValues: { ':pk': pk },
          Select: 'COUNT',
          ExclusiveStartKey: startKey,
          ReturnConsumedCapacity: 'TOTAL',
        }),
      );
      stats.queries += 1;
      stats.consumedRcu += res.ConsumedCapacity?.CapacityUnits ?? 0;
      count += res.Count ?? 0;
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return count;
  }
}
