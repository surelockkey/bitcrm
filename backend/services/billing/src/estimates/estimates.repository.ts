import { Injectable } from '@nestjs/common';
import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import {
  DynamoDbService,
  countRows,
  type CountRowsResult,
} from '@bitcrm/shared';
import type { Estimate, EstimateItem, EstimateStatus } from '@bitcrm/types';
import {
  BILLING_GSI1_NAME,
  BILLING_GSI2_NAME,
  BILLING_GSI3_NAME,
  BILLING_TABLE,
  COUNTERS_SK,
  ESTIMATES_GSI1PK,
  ITEM_SK_PREFIX,
  METADATA_SK,
  contactGsi2Pk,
  contactGsi2Sk,
  dealCountersPk,
  dealGsi3Pk,
  dealGsi3Sk,
  estimateItemSk,
  estimatePk,
  listSk,
  stripKeys,
} from '../common/constants/dynamo.constants';
import { decodeCursor, encodeCursor } from '../common/cursor';
import { isConditionalCheckFailed } from '../common/dynamo-errors';
import { buildUpdate } from '../common/update-expression';
import { sortItems } from './estimate-rules';

export class EstimateVersionConflictError extends Error {
  constructor() {
    super('Estimate version conflict');
  }
}

export interface EstimateListFilter {
  status?: EstimateStatus;
  contactId?: string;
  dealId?: string;
  limit: number;
  cursor?: string;
}

/**
 * Estimates and their lines, one partition per estimate.
 *
 *   PK = ESTIMATE#<id>, SK = METADATA
 *     GSI1 (ListIndex):    GSI1PK = ESTIMATES,           GSI1SK = <createdAt>#<id>
 *     GSI2 (ContactIndex): GSI2PK = CONTACT#<contactId>, GSI2SK = ESTIMATE#<createdAt>#<id>
 *     GSI3 (DealIndex):    GSI3PK = DEAL#<dealId>,       GSI3SK = ESTIMATE#<createdAt>#<id>
 *   PK = ESTIMATE#<id>, SK = ITEM#<lineId>     line rows, ordered by `position`
 *   PK = DEAL#<dealId>, SK = COUNTERS          `estimateSeq` (ADD 1 per new estimate)
 */
@Injectable()
export class EstimatesRepository {
  constructor(private readonly db: DynamoDbService) {}

  private metadataItem(e: Estimate) {
    return {
      PK: estimatePk(e.id),
      SK: METADATA_SK,
      GSI1PK: ESTIMATES_GSI1PK,
      GSI1SK: listSk(e.createdAt, e.id),
      GSI2PK: contactGsi2Pk(e.contactId),
      GSI2SK: contactGsi2Sk('ESTIMATE', e.createdAt, e.id),
      GSI3PK: dealGsi3Pk(e.dealId),
      GSI3SK: dealGsi3Sk(e.createdAt, e.id),
      entityType: 'estimate',
      ...e,
    };
  }

  private itemRow(i: EstimateItem) {
    return { PK: estimatePk(i.estimateId), SK: estimateItemSk(i.lineId), entityType: 'estimate_item', ...i };
  }

  /** Atomic per-job counter; the returned value is never handed out twice. */
  async nextSeq(dealId: string): Promise<number> {
    const res = await this.db.client.send(
      new UpdateCommand({
        TableName: BILLING_TABLE,
        Key: { PK: dealCountersPk(dealId), SK: COUNTERS_SK },
        UpdateExpression: 'ADD estimateSeq :one',
        ExpressionAttributeValues: { ':one': 1 },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    return Number(res.Attributes?.estimateSeq ?? 1);
  }

  async create(estimate: Estimate, items: EstimateItem[]): Promise<void> {
    const head = {
      Put: {
        TableName: BILLING_TABLE,
        Item: this.metadataItem(estimate),
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    };
    const first = items.slice(0, 99).map((i) => ({ Put: { TableName: BILLING_TABLE, Item: this.itemRow(i) } }));
    await this.db.client.send(new TransactWriteCommand({ TransactItems: [head, ...first] }));
    await this.batchPut(items.slice(99));
  }

  async get(id: string): Promise<{ estimate: Estimate; items: EstimateItem[] } | null> {
    const rows: Record<string, unknown>[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.client.send(
        new QueryCommand({
          TableName: BILLING_TABLE,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': estimatePk(id) },
          ExclusiveStartKey,
        }),
      );
      rows.push(...(res.Items ?? []));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    const meta = rows.find((r) => r.SK === METADATA_SK);
    if (!meta) return null;
    const items = rows
      .filter((r) => typeof r.SK === 'string' && (r.SK as string).startsWith(ITEM_SK_PREFIX))
      .map((r) => stripKeys<EstimateItem>(r)!);
    return { estimate: stripKeys<Estimate>(meta)!, items: sortItems(items) };
  }

  async getMetadata(id: string): Promise<Estimate | null> {
    const res = await this.db.client.send(
      new GetCommand({ TableName: BILLING_TABLE, Key: { PK: estimatePk(id), SK: METADATA_SK } }),
    );
    return stripKeys<Estimate>(res.Item);
  }

  /**
   * Partial update; bumps `version`. With `expectedVersion` the write is
   * refused (EstimateVersionConflictError) when someone else wrote in between.
   * A `contactId` change (with the row's `createdAt`) moves the GSI2 key with it.
   */
  async update(
    id: string,
    set: Partial<Estimate>,
    remove: string[] = [],
    expectedVersion?: number,
  ): Promise<Estimate> {
    const patch: Record<string, unknown> = { ...set };
    if (typeof set.contactId === 'string' && typeof set.createdAt === 'string') {
      patch.GSI2PK = contactGsi2Pk(set.contactId);
      patch.GSI2SK = contactGsi2Sk('ESTIMATE', set.createdAt, id);
    }
    delete patch.version;
    const expr = buildUpdate(patch, remove, { incrementVersion: true });
    const conditions = ['attribute_exists(PK)'];
    if (expectedVersion !== undefined) {
      expr.ExpressionAttributeNames['#ev'] = 'version';
      expr.ExpressionAttributeValues[':ev'] = expectedVersion;
      conditions.push('#ev = :ev');
    }
    try {
      const res = await this.db.client.send(
        new UpdateCommand({
          TableName: BILLING_TABLE,
          Key: { PK: estimatePk(id), SK: METADATA_SK },
          ...expr,
          ConditionExpression: conditions.join(' AND '),
          ReturnValues: 'ALL_NEW',
        }),
      );
      return stripKeys<Estimate>(res.Attributes)!;
    } catch (err) {
      if (isConditionalCheckFailed(err)) throw new EstimateVersionConflictError();
      throw err;
    }
  }

  async putItem(item: EstimateItem): Promise<void> {
    await this.db.client.send(new PutCommand({ TableName: BILLING_TABLE, Item: this.itemRow(item) }));
  }

  async deleteItem(estimateId: string, lineId: string): Promise<void> {
    await this.db.client.send(
      new DeleteCommand({
        TableName: BILLING_TABLE,
        Key: { PK: estimatePk(estimateId), SK: estimateItemSk(lineId) },
      }),
    );
  }

  async setPositions(
    estimateId: string,
    positions: Array<{ lineId: string; position: number }>,
    now: string,
  ): Promise<void> {
    for (let i = 0; i < positions.length; i += 100) {
      await this.db.client.send(
        new TransactWriteCommand({
          TransactItems: positions.slice(i, i + 100).map((p) => ({
            Update: {
              TableName: BILLING_TABLE,
              Key: { PK: estimatePk(estimateId), SK: estimateItemSk(p.lineId) },
              UpdateExpression: 'SET #pos = :pos, updatedAt = :now',
              ConditionExpression: 'attribute_exists(PK)',
              ExpressionAttributeNames: { '#pos': 'position' },
              ExpressionAttributeValues: { ':pos': p.position, ':now': now },
            },
          })),
        }),
      );
    }
  }

  async listByDeal(dealId: string): Promise<Estimate[]> {
    const out: Estimate[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.client.send(
        new QueryCommand({
          TableName: BILLING_TABLE,
          IndexName: BILLING_GSI3_NAME,
          KeyConditionExpression: 'GSI3PK = :pk',
          ExpressionAttributeValues: { ':pk': dealGsi3Pk(dealId) },
          ExclusiveStartKey,
        }),
      );
      for (const i of res.Items ?? []) out.push(stripKeys<Estimate>(i)!);
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
  }

  /**
   * The Query that selects estimates, shared by the list and its count so the
   * two can never answer about different populations.
   */
  private buildListQuery(filter: EstimateListFilter): QueryCommandInput {
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    let input: QueryCommandInput;
    if (filter.dealId) {
      values[':pk'] = dealGsi3Pk(filter.dealId);
      input = { TableName: BILLING_TABLE, IndexName: BILLING_GSI3_NAME, KeyConditionExpression: 'GSI3PK = :pk' };
    } else if (filter.contactId) {
      values[':pk'] = contactGsi2Pk(filter.contactId);
      values[':prefix'] = 'ESTIMATE#';
      input = {
        TableName: BILLING_TABLE,
        IndexName: BILLING_GSI2_NAME,
        KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :prefix)',
      };
    } else {
      values[':pk'] = ESTIMATES_GSI1PK;
      input = { TableName: BILLING_TABLE, IndexName: BILLING_GSI1_NAME, KeyConditionExpression: 'GSI1PK = :pk' };
    }
    const filters: string[] = [];
    if (filter.status) {
      names['#status'] = 'status';
      values[':status'] = filter.status;
      filters.push('#status = :status');
    }
    if (filter.dealId && filter.contactId) {
      names['#contactId'] = 'contactId';
      values[':contactId'] = filter.contactId;
      filters.push('#contactId = :contactId');
    }

    return {
      ...input,
      ScanIndexForward: false,
      ExpressionAttributeValues: values,
      ...(Object.keys(names).length && { ExpressionAttributeNames: names }),
      ...(filters.length && { FilterExpression: filters.join(' AND ') }),
    };
  }

  async list(filter: EstimateListFilter): Promise<{ items: Estimate[]; nextCursor?: string }> {
    const input = this.buildListQuery(filter);

    const items: Estimate[] = [];
    let startKey = decodeCursor<Record<string, unknown>>(filter.cursor);
    for (let round = 0; round < 25 && items.length < filter.limit; round++) {
      const res = await this.db.client.send(
        new QueryCommand({
          ...input,
          Limit: filter.limit - items.length,
          ExclusiveStartKey: startKey,
        }),
      );
      for (const i of res.Items ?? []) items.push(stripKeys<Estimate>(i)!);
      startKey = res.LastEvaluatedKey;
      if (!startKey) break;
    }
    return { items, nextCursor: startKey ? encodeCursor(startKey) : undefined };
  }

  /**
   * How many estimates the filter selects — the number behind "Page 2 of 7".
   * The same Query with `Select: 'COUNT'`, so no estimate bodies travel.
   */
  async count(filter: EstimateListFilter): Promise<CountRowsResult> {
    const input = this.buildListQuery(filter);

    return countRows((page) =>
      this.db.client.send(new QueryCommand({ ...input, Select: 'COUNT', ...page })),
    );
  }

  /** Every estimate (paged internally) — for the summary. */
  async listAll(): Promise<Estimate[]> {
    const out: Estimate[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.client.send(
        new QueryCommand({
          TableName: BILLING_TABLE,
          IndexName: BILLING_GSI1_NAME,
          KeyConditionExpression: 'GSI1PK = :pk',
          ExpressionAttributeValues: { ':pk': ESTIMATES_GSI1PK },
          // dealId: the summary filters a technician's rows by job.
          ProjectionExpression: '#status, totals, id, dealId',
          ExpressionAttributeNames: { '#status': 'status' },
          ExclusiveStartKey,
        }),
      );
      for (const i of res.Items ?? []) out.push(i as Estimate);
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
  }

  /** Removes the estimate and every line row. */
  async delete(id: string): Promise<void> {
    const found = await this.get(id);
    const keys = [
      { PK: estimatePk(id), SK: METADATA_SK },
      ...(found?.items ?? []).map((i) => ({ PK: estimatePk(id), SK: estimateItemSk(i.lineId) })),
    ];
    for (let i = 0; i < keys.length; i += 25) {
      await this.batchWriteWithRetry(keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })));
    }
  }

  async deleteCounter(dealId: string): Promise<void> {
    await this.db.client.send(
      new DeleteCommand({ TableName: BILLING_TABLE, Key: { PK: dealCountersPk(dealId), SK: COUNTERS_SK } }),
    );
  }

  private async batchPut(items: EstimateItem[]): Promise<void> {
    for (let i = 0; i < items.length; i += 25) {
      await this.batchWriteWithRetry(
        items.slice(i, i + 25).map((it) => ({ PutRequest: { Item: this.itemRow(it) } })),
      );
    }
  }

  private async batchWriteWithRetry(requests: Record<string, unknown>[]): Promise<void> {
    let pending = requests;
    for (let attempt = 0; attempt < 5 && pending.length; attempt++) {
      const res = await this.db.client.send(
        new BatchWriteCommand({ RequestItems: { [BILLING_TABLE]: pending as never } }),
      );
      pending = (res.UnprocessedItems?.[BILLING_TABLE] as Record<string, unknown>[] | undefined) ?? [];
      if (pending.length) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
    }
  }
}
