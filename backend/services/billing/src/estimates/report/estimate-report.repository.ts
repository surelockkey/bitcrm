import { Injectable } from '@nestjs/common';
import { QueryCommand, type QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService, countRows, type CountRowsResult } from '@bitcrm/shared';
import type { Estimate } from '@bitcrm/types';
import { BILLING_GSI1_NAME, BILLING_TABLE, ESTIMATES_GSI1PK, stripKeys } from '../../common/constants/dynamo.constants';
import { decodeCursor, encodeCursor } from '../../common/cursor';
import { normalizeEstimateSearch, type EstimateCardRow, type EstimateReportFilter } from './estimate-report.rules';

const MAX_ROUNDS_PER_PAGE = 25;

/**
 * The Estimates report's reads of the estimate list (GSI1 `ESTIMATES`,
 * `<createdAt>#<id>`): the created-date window is the key condition (New
 * York days as UTC instants), Status and Search one FilterExpression shared
 * by the page and its count. ~450 estimates a month, ~8 600 in all.
 */
@Injectable()
export class EstimateReportRepository {
  constructor(private readonly db: DynamoDbService) {}

  buildQuery(f: EstimateReportFilter, dir: 'asc' | 'desc' = 'desc'): QueryCommandInput {
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = { ':pk': ESTIMATES_GSI1PK };
    let key = 'GSI1PK = :pk';
    if (f.fromIso && f.toIso) {
      values[':from'] = f.fromIso;
      values[':to'] = f.toIso;
      key += ' AND GSI1SK BETWEEN :from AND :to';
    } else if (f.fromIso) {
      values[':from'] = f.fromIso;
      key += ' AND GSI1SK >= :from';
    } else if (f.toIso) {
      values[':to'] = f.toIso;
      key += ' AND GSI1SK < :to';
    }
    const filters: string[] = [];
    if (f.status) {
      names['#st'] = 'status';
      values[':st'] = f.status;
      filters.push('#st = :st');
    }
    const q = normalizeEstimateSearch(f.search);
    if (q) {
      names['#num'] = 'number';
      names['#name'] = 'name';
      values[':q'] = q;
      values[':qu'] = q.toUpperCase();
      filters.push('(contains(#num, :q) OR contains(#num, :qu) OR contains(#name, :q))');
    }
    return {
      TableName: BILLING_TABLE,
      IndexName: BILLING_GSI1_NAME,
      KeyConditionExpression: key,
      ScanIndexForward: dir === 'asc',
      ExpressionAttributeValues: values,
      ...(Object.keys(names).length && { ExpressionAttributeNames: names }),
      ...(filters.length && { FilterExpression: filters.join(' AND ') }),
    };
  }

  async page(
    f: EstimateReportFilter,
    limit: number,
    cursor?: string,
    dir: 'asc' | 'desc' = 'desc',
  ): Promise<{ items: Estimate[]; nextCursor?: string }> {
    const input = this.buildQuery(f, dir);
    const items: Estimate[] = [];
    let startKey = decodeCursor<Record<string, unknown>>(cursor);
    for (let round = 0; round < MAX_ROUNDS_PER_PAGE && items.length < limit; round++) {
      const res = await this.db.client.send(
        new QueryCommand({ ...input, Limit: limit - items.length, ExclusiveStartKey: startKey }),
      );
      for (const i of res.Items ?? []) items.push(stripKeys<Estimate>(i)!);
      startKey = res.LastEvaluatedKey;
      if (!startKey) break;
    }
    return { items, nextCursor: startKey ? encodeCursor(startKey) : undefined };
  }

  count(f: EstimateReportFilter): Promise<CountRowsResult> {
    const input = this.buildQuery(f);
    return countRows((page) => this.db.client.send(new QueryCommand({ ...input, Select: 'COUNT', ...page })));
  }

  /** The window's estimates, projected to what the cards need (status and amount). */
  async cardRows(f: Pick<EstimateReportFilter, 'fromIso' | 'toIso'>): Promise<EstimateCardRow[]> {
    const input = this.buildQuery({ fromIso: f.fromIso, toIso: f.toIso });
    const out: EstimateCardRow[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.client.send(
        new QueryCommand({
          ...input,
          ProjectionExpression: '#p0, #p1, #p2, #p3',
          ExpressionAttributeNames: {
            ...(input.ExpressionAttributeNames ?? {}),
            '#p0': 'status',
            '#p1': 'totals',
            '#p2': 'workizTotal',
            '#p3': 'dealId',
          },
          ExclusiveStartKey: startKey,
        }),
      );
      for (const i of res.Items ?? []) out.push(i as EstimateCardRow);
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return out;
  }

  /** Every matching estimate, newest first (oldest with `asc`), up to `max` (the export). */
  async walk(
    f: EstimateReportFilter,
    max: number,
    dir: 'asc' | 'desc' = 'desc',
  ): Promise<{ items: Estimate[]; truncated: boolean }> {
    const input = this.buildQuery(f, dir);
    const items: Estimate[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.client.send(new QueryCommand({ ...input, ExclusiveStartKey: startKey }));
      for (const i of res.Items ?? []) {
        if (items.length >= max) return { items, truncated: true };
        items.push(stripKeys<Estimate>(i)!);
      }
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return { items, truncated: false };
  }
}
