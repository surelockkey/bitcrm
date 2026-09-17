import { Injectable, Logger } from '@nestjs/common';
import { DeleteCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type AutomationRun } from '@bitcrm/types';
import {
  MESSAGING_GSI3_NAME,
  MESSAGING_TABLE,
  METADATA_SK,
  MESSAGING_TTL_ATTRIBUTE,
  automationPk,
} from '../../common/constants/dynamo.constants';
import { InvalidCursorError, decodeCursor, encodeCursor } from '../../common/cursor';
import { compact, epochSeconds, stripKeys } from '../../common/items';
import { isConditionalCheckFailed } from '../../common/dynamo-errors';
import {
  AUTO_ONCE_TTL_SECONDS,
  AUTO_RUN_FEED_MAX_QUERIES,
  AUTO_RUN_SK_PREFIX,
  AUTO_RUN_TTL_SECONDS,
  autoOnceSk,
  autoRunFeedGsi3Pk,
  autoRunFeedGsi3Sk,
  autoRunFeedMonths,
  autoRunPk,
  autoRunSk,
  runMonthOf,
} from '../automations.constants';

/** What `GET /automations/runs` asks for. */
export interface AutomationRunFeedQuery {
  limit: number;
  cursor?: string;
  /** One rule's firings — served from its own partition, not the feed index. */
  ruleId?: string;
  outcome?: string;
  /** ISO instant; only firings at or after it. */
  since?: string;
  /** The clock, for the month partitions to read. Tests hand one in. */
  now?: Date;
}

export interface AutomationRunFeedPage {
  items: AutomationRun[];
  nextCursor?: string;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The firing log and the idempotency ledger of the rule engine
 * (`AUTORUN#<ruleId>`, design §3.2 + §4.9):
 *
 *   claim()  writes `ONCE#<entity>#<occurrence>` with `attribute_not_exists`
 *            — the first caller wins, everyone after it is a duplicate. This
 *            is what makes an SQS redelivery, a replayed queue or two
 *            instances racing send one message, not three.
 *   log()    appends `RUN#<firedAt>#<runId>` — what the Automation Center's
 *            "last firings" list and the test-run dialog read.
 *   bump()   moves `firedCount` / `lastFiredAt` on the rule itself with an
 *            atomic ADD, so the counter survives a concurrent rule edit.
 *
 * Both run items carry a TTL: the log is history, not an audit trail.
 */
@Injectable()
export class AutomationRunsRepository {
  private readonly logger = new Logger(AutomationRunsRepository.name);
  private tableName = MESSAGING_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  /** `true` when this firing is ours to run; `false` when someone already ran it. */
  async claim(
    ruleId: string,
    entity: string,
    occurrence: string,
    at: string = new Date().toISOString(),
  ): Promise<boolean> {
    try {
      await this.dynamoDb.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: autoRunPk(ruleId),
            SK: autoOnceSk(entity, occurrence),
            ruleId,
            entity,
            occurrence,
            claimedAt: at,
            [MESSAGING_TTL_ATTRIBUTE]: epochSeconds(at) + AUTO_ONCE_TTL_SECONDS,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      return true;
    } catch (error) {
      if (isConditionalCheckFailed(error)) return false;
      throw error;
    }
  }

  /**
   * Gives a claim back — used when the firing could not even be attempted
   * (the job vanished, the queue was down) so the next delivery may retry.
   * Never called after an action ran: a half-sent firing must not repeat.
   */
  async release(ruleId: string, entity: string, occurrence: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: autoRunPk(ruleId), SK: autoOnceSk(entity, occurrence) },
      }),
    );
  }

  /**
   * Appends one firing to the rule's log, and to the month partition the
   * account-wide feed reads. Best-effort: a lost log line never fails a send.
   */
  async log(run: AutomationRun): Promise<AutomationRun> {
    const item = {
      PK: autoRunPk(run.ruleId),
      SK: autoRunSk(run.firedAt, run.id),
      GSI3PK: autoRunFeedGsi3Pk(runMonthOf(run.firedAt)),
      GSI3SK: autoRunFeedGsi3Sk(run.firedAt, run.id),
      ...compact(run as unknown as Record<string, unknown>),
      [MESSAGING_TTL_ATTRIBUTE]: run.expiresAt ?? epochSeconds(run.firedAt) + AUTO_RUN_TTL_SECONDS,
    };
    await this.dynamoDb.client.send(new PutCommand({ TableName: this.tableName, Item: item }));
    return run;
  }

  /** The rule's firings, newest first. */
  async listByRule(ruleId: string, limit = 20): Promise<AutomationRun[]> {
    const res = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': autoRunPk(ruleId), ':sk': AUTO_RUN_SK_PREFIX },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (res.Items ?? []).map((i) => stripKeys<AutomationRun>(i, [MESSAGING_TTL_ATTRIBUTE]));
  }

  /**
   * The account-wide feed, newest first: every rule's firings, or one
   * rule's when `ruleId` narrows it.
   *
   *   ruleId given   the rule's own partition — no index, no filter, and it
   *                  sees rows logged before the feed keys existed
   *   otherwise      `AUTORUN#<YYYY-MM>` on GSI3, current month first and
   *                  back over the retention window (`autoRunFeedMonths`)
   *
   * `since` is a key condition on both paths. `outcome` is the one real
   * filter: it is not part of any key, so a page narrowed by it can come
   * back short of `limit` with a cursor — follow the cursor, do not read
   * a short page as the end.
   */
  async listFeed(query: AutomationRunFeedQuery): Promise<AutomationRunFeedPage> {
    const partitions = query.ruleId
      ? [query.ruleId]
      : autoRunFeedMonths(query.now ?? new Date(), query.since);
    const raw = decodeCursor<{ p?: unknown; k?: unknown }>(query.cursor);
    // `typeof null` and `typeof []` are both 'object', and either one reaches
    // DynamoDB as a malformed ExclusiveStartKey — a 500 for what is a bad
    // cursor, which is a 400.
    if (raw && (typeof raw.p !== 'string' || (raw.k !== undefined && !isPlainObject(raw.k)))) {
      throw new InvalidCursorError();
    }

    let index = raw ? partitions.indexOf(raw.p as string) : 0;
    if (index < 0) throw new InvalidCursorError();
    let startKey = raw?.k as Record<string, unknown> | undefined;

    const items: AutomationRun[] = [];
    let queries = 0;
    while (index < partitions.length && items.length < query.limit && queries < AUTO_RUN_FEED_MAX_QUERIES) {
      const res = await this.queryRuns(partitions[index], startKey, query.limit - items.length, query);
      queries += 1;
      items.push(...(res.Items ?? []).map((i) => stripKeys<AutomationRun>(i, [MESSAGING_TTL_ATTRIBUTE])));
      if (res.LastEvaluatedKey) {
        startKey = res.LastEvaluatedKey;
      } else {
        index += 1;
        startKey = undefined;
      }
    }

    if (index >= partitions.length) return { items };
    return { items, nextCursor: encodeCursor({ p: partitions[index], ...(startKey ? { k: startKey } : {}) }) };
  }

  /** One page of one partition — the rule's own, or a month of the feed index. */
  private async queryRuns(
    partition: string,
    exclusiveStartKey: Record<string, unknown> | undefined,
    limit: number,
    query: AutomationRunFeedQuery,
  ) {
    // The same test `listFeed` chose the partitions by: `ruleId !== undefined`
    // would send an empty one down the per-rule path and query
    // `AUTORUN#<a month>` on the base table, which holds nothing.
    const byRule = Boolean(query.ruleId);
    // `ONCE#` sorts below `RUN#`, so "at or after this run key" selects the
    // log and nothing else — which is what lets `since` be a key condition
    // rather than a filter over the whole partition.
    const sortKey = byRule ? 'SK' : 'GSI3SK';
    const lower = byRule ? `${AUTO_RUN_SK_PREFIX}${query.since ?? ''}` : (query.since ?? '');
    return this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        ...(byRule ? {} : { IndexName: MESSAGING_GSI3_NAME }),
        KeyConditionExpression: query.since
          ? `${byRule ? 'PK' : 'GSI3PK'} = :pk AND ${sortKey} >= :sk`
          : byRule
            ? 'PK = :pk AND begins_with(SK, :sk)'
            : 'GSI3PK = :pk',
        ...(query.outcome
          ? { FilterExpression: '#outcome = :outcome', ExpressionAttributeNames: { '#outcome': 'outcome' } }
          : {}),
        ExpressionAttributeValues: {
          ':pk': byRule ? autoRunPk(partition) : autoRunFeedGsi3Pk(partition),
          ...(query.since || byRule ? { ':sk': lower } : {}),
          ...(query.outcome ? { ':outcome': query.outcome } : {}),
        },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
  }

  /** `firedCount += 1`, `lastFiredAt = at` on `AUTOMATION#<ruleId>` — atomic, never a read-modify-write. */
  async bump(ruleId: string, at: string): Promise<void> {
    try {
      await this.dynamoDb.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: automationPk(ruleId), SK: METADATA_SK },
          UpdateExpression: 'ADD firedCount :one SET lastFiredAt = :at',
          ExpressionAttributeValues: { ':one': 1, ':at': at },
          // A built-in rule nobody has edited has no row yet; its counter
          // starts the day it is first switched on or edited.
          ConditionExpression: 'attribute_exists(PK)',
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailed(error)) return;
      this.logger.warn(`Firing counter for ${ruleId} not updated: ${error instanceof Error ? error.message : error}`);
    }
  }
}
