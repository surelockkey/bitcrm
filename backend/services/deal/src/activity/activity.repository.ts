import { Injectable, Logger } from '@nestjs/common';
import { BatchGetCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { accountDaysBetween, accountWindowUtc, type ActivitySort } from '@bitcrm/types';
import { DEALS_TABLE } from '../common/constants/dynamo.constants';
import {
  ACTIVITY_ACTOR_INDEX,
  ACTIVITY_DAY_INDEX,
  activityActorPk,
  activityDayPk,
} from './activity.constants';

type Item = Record<string, unknown>;

/** Rows per internal page while a search filter is thinning them out. */
const FILTER_PAGE = 200;
/** Queries one page / one count may spend before it hands back what it has. */
export const ACTIVITY_PAGE_BUDGET = 40;
export const ACTIVITY_COUNT_BUDGET = 200;

/**
 * Where a page stopped. By day: the day and the key to resume from in it. By
 * actor: the sort key of the last row handed out — every actor's query
 * resumes from there, so the merge needs no per-actor state.
 */
export interface ActivityCursor {
  d?: string;
  k?: Item;
  s?: string;
}

export interface ActivityPageQuery {
  /** Account days, inclusive. */
  from: string;
  to: string;
  sort: ActivitySort;
  limit: number;
  /** Lower-cased search text. */
  q?: string;
  /** The deal the search text names as a job code, if it does. */
  qDealId?: string;
  userIds?: string[];
  cursor?: ActivityCursor;
  budget?: number;
}

export interface ActivityPage {
  items: Item[];
  next?: ActivityCursor;
}

/**
 * Reads the Activity indexes of the deals table (keys in
 * `activity.constants.ts`) — never a Scan. The whole period, newest first, is a
 * walk over its day partitions (ActivityDayIndex); a set of people is one
 * query per person over the period (ActorIndex), merged. The search is a
 * FilterExpression on `activitySearch` inside the same walk, bounded by a read
 * budget: a page may come back short, with a cursor, rather than walk a year.
 */
@Injectable()
export class ActivityRepository {
  private readonly logger = new Logger(ActivityRepository.name);
  private readonly tableName = DEALS_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  async page(q: ActivityPageQuery): Promise<ActivityPage> {
    return q.userIds?.length ? this.pageByActors(q) : this.pageByDays(q);
  }

  /** How many rows match — exact unless the budget ran out (`atLeast`). */
  async count(q: Omit<ActivityPageQuery, 'limit' | 'cursor' | 'sort'>): Promise<{ total: number; atLeast: boolean }> {
    const budget = q.budget ?? ACTIVITY_COUNT_BUDGET;
    let total = 0;
    let queries = 0;
    const filter = this.filterOf(q);
    const partitions = q.userIds?.length
      ? q.userIds.map((u) => ({ index: ACTIVITY_ACTOR_INDEX, ...this.actorRange(u, q.from, q.to, 'desc') }))
      : accountDaysBetween(q.from, q.to).map((day) => ({
          index: ACTIVITY_DAY_INDEX,
          keyCondition: 'GSI8PK = :pk',
          values: { ':pk': activityDayPk(day) } as Item,
        }));

    for (const p of partitions) {
      let startKey: Item | undefined;
      do {
        if (queries >= budget) return { total, atLeast: true };
        queries += 1;
        const res = await this.dynamoDb.client.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: p.index,
            KeyConditionExpression: p.keyCondition,
            ...(filter && { FilterExpression: filter.expression, ExpressionAttributeNames: filter.names }),
            ExpressionAttributeValues: { ...p.values, ...(filter?.values ?? {}) },
            Select: 'COUNT',
            ...(startKey && { ExclusiveStartKey: startKey }),
          }),
        );
        total += res.Count ?? 0;
        startKey = res.LastEvaluatedKey;
      } while (startKey);
    }
    return { total, atLeast: false };
  }

  /** Deal numbers of the page's jobs — the Job Id of a native event. */
  async dealNumbers(dealIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const unique = [...new Set(dealIds)];
    for (let i = 0; i < unique.length; i += 100) {
      const res = await this.dynamoDb.client.send(
        new BatchGetCommand({
          RequestItems: {
            [this.tableName]: {
              Keys: unique.slice(i, i + 100).map((id) => ({ PK: `DEAL#${id}`, SK: 'METADATA' })),
              ProjectionExpression: 'id, dealNumber',
            },
          },
        }),
      );
      for (const item of res.Responses?.[this.tableName] ?? []) {
        if (typeof item.id === 'string' && typeof item.dealNumber === 'string') out.set(item.id, item.dealNumber);
      }
    }
    return out;
  }

  /** The deal a job code names (`DEALNUM#<code>` reservation), for "search by Job Id". */
  async dealIdByNumber(code: string): Promise<string | undefined> {
    if (!/^[A-Za-z0-9]{4,12}$/.test(code)) return undefined;
    const res = await this.dynamoDb.client.send(
      new GetCommand({ TableName: this.tableName, Key: { PK: `DEALNUM#${code.toUpperCase()}`, SK: 'UNIQUE' } }),
    );
    return typeof res.Item?.dealId === 'string' ? res.Item.dealId : undefined;
  }

  /* --------------------------------------------------------------- by day */

  private async pageByDays(q: ActivityPageQuery): Promise<ActivityPage> {
    const budget = q.budget ?? ACTIVITY_PAGE_BUDGET;
    const days = accountDaysBetween(q.from, q.to);
    if (q.sort === 'desc') days.reverse();
    let i = q.cursor?.d ? days.indexOf(q.cursor.d) : 0;
    if (i < 0) return { items: [] };
    let startKey = q.cursor?.k;
    const filter = this.filterOf(q);
    const items: Item[] = [];
    let queries = 0;

    for (; i < days.length; i += 1) {
      const day = days[i];
      for (;;) {
        if (queries >= budget) return { items, next: { d: day, ...(startKey && { k: startKey }) } };
        queries += 1;
        const room = q.limit - items.length;
        const res = await this.dynamoDb.client.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: ACTIVITY_DAY_INDEX,
            KeyConditionExpression: 'GSI8PK = :pk',
            ...(filter && { FilterExpression: filter.expression, ExpressionAttributeNames: filter.names }),
            ExpressionAttributeValues: { ':pk': activityDayPk(day), ...(filter?.values ?? {}) },
            ScanIndexForward: q.sort === 'asc',
            Limit: filter ? FILTER_PAGE : room,
            ...(startKey && { ExclusiveStartKey: startKey }),
          }),
        );
        const page = res.Items ?? [];
        items.push(...page.slice(0, room));
        if (items.length >= q.limit) {
          const resume = page.length > room ? this.dayKeyOf(items[items.length - 1]) : res.LastEvaluatedKey;
          if (resume) return { items, next: { d: day, k: resume } };
          return { items, next: days[i + 1] ? { d: days[i + 1] } : undefined };
        }
        if (!res.LastEvaluatedKey) break;
        startKey = res.LastEvaluatedKey;
      }
      startKey = undefined;
    }
    return { items };
  }

  private dayKeyOf(item: Item): Item {
    return { PK: item.PK, SK: item.SK, GSI8PK: item.GSI8PK, GSI8SK: item.GSI8SK };
  }

  /* ------------------------------------------------------------ by actor */

  private actorRange(
    userId: string,
    from: string,
    to: string,
    sort: ActivitySort,
    cursor?: string,
  ): { keyCondition: string; values: Item } {
    const { start, end } = accountWindowUtc(from, to);
    const last = `${new Date(Date.parse(end) - 1).toISOString()}￿`;
    const lo = sort === 'asc' && cursor ? cursor : start;
    const hi = sort === 'desc' && cursor ? cursor : last;
    return {
      keyCondition: 'GSI9PK = :pk AND GSI9SK BETWEEN :lo AND :hi',
      values: { ':pk': activityActorPk(userId), ':lo': lo, ':hi': hi },
    };
  }

  private async pageByActors(q: ActivityPageQuery): Promise<ActivityPage> {
    const budget = q.budget ?? ACTIVITY_PAGE_BUDGET;
    const filter = this.filterOf(q);
    const after = q.cursor?.s;
    const perActorBudget = Math.max(1, Math.floor(budget / q.userIds!.length));

    const results = await Promise.all(
      q.userIds!.map(async (userId) => {
        const range = this.actorRange(userId, q.from, q.to, q.sort, after);
        const found: Item[] = [];
        let startKey: Item | undefined;
        let queries = 0;
        let edge: string | undefined;
        for (;;) {
          queries += 1;
          const res = await this.dynamoDb.client.send(
            new QueryCommand({
              TableName: this.tableName,
              IndexName: ACTIVITY_ACTOR_INDEX,
              KeyConditionExpression: range.keyCondition,
              ...(filter && { FilterExpression: filter.expression, ExpressionAttributeNames: filter.names }),
              ExpressionAttributeValues: { ...range.values, ...(filter?.values ?? {}) },
              ScanIndexForward: q.sort === 'asc',
              Limit: filter ? FILTER_PAGE : q.limit + 1,
              ...(startKey && { ExclusiveStartKey: startKey }),
            }),
          );
          // The cursor's own row sits on the range's edge; it was handed out already.
          found.push(...(res.Items ?? []).filter((it) => it.GSI9SK !== after));
          startKey = res.LastEvaluatedKey;
          if (!startKey) return { found, done: true, edge };
          edge = startKey.GSI9SK as string;
          if (found.length >= q.limit || queries >= perActorBudget) return { found, done: false, edge };
        }
      }),
    );

    const desc = q.sort === 'desc';
    const cmp = (a: Item, b: Item) =>
      desc ? String(b.GSI9SK).localeCompare(String(a.GSI9SK)) : String(a.GSI9SK).localeCompare(String(b.GSI9SK));
    // An unfinished actor may still hold rows past where it stopped: nothing
    // beyond the nearest such edge can be handed out yet.
    const edges = results.filter((r) => !r.done && r.edge).map((r) => r.edge as string);
    const bound = edges.length ? (desc ? edges.sort().at(-1)! : edges.sort()[0]) : undefined;
    const merged = results
      .flatMap((r) => r.found)
      .filter((it) => bound === undefined || (desc ? String(it.GSI9SK) >= bound : String(it.GSI9SK) <= bound))
      .sort(cmp);
    const items = merged.slice(0, q.limit);
    const more = merged.length > q.limit || results.some((r) => !r.done);
    if (!more) return { items };
    const lastSk = items.length ? String(items[items.length - 1].GSI9SK) : bound;
    return { items, next: lastSk ? { s: lastSk } : undefined };
  }

  /* ---------------------------------------------------------------- filter */

  private filterOf(q: { q?: string; qDealId?: string }):
    | { expression: string; names: Record<string, string>; values: Item }
    | undefined {
    if (!q.q) return undefined;
    const names: Record<string, string> = { '#search': 'activitySearch' };
    const values: Item = { ':q': q.q };
    let expression = 'contains(#search, :q)';
    if (q.qDealId) {
      names['#dealId'] = 'dealId';
      values[':qDeal'] = q.qDealId;
      expression = `(${expression} OR #dealId = :qDeal)`;
    }
    return { expression, names, values };
  }
}
