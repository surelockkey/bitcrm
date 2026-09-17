import { Injectable } from '@nestjs/common';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import type { Invoice, InvoiceStatus } from '@bitcrm/types';
import {
  BILLING_GSI1_NAME,
  BILLING_GSI2_NAME,
  BILLING_TABLE,
  INVOICES_GSI1PK,
  METADATA_SK,
  contactGsi2Pk,
  contactGsi2Sk,
  invoicePk,
  listSk,
  stripKeys,
} from '../common/constants/dynamo.constants';
import { decodeCursor, encodeCursor } from '../common/cursor';
import { isConditionalCheckFailed } from '../common/dynamo-errors';
import { buildUpdate } from '../common/update-expression';

export class InvoiceExistsError extends Error {
  constructor() {
    super('Invoice already exists');
  }
}
export class InvoiceVersionConflictError extends Error {
  constructor() {
    super('Invoice version conflict');
  }
}

export interface InvoiceListFilter {
  status?: InvoiceStatus;
  unsent?: boolean;
  contactId?: string;
  /** Inclusive YYYY-MM-DD bounds on createdAt. */
  from?: string;
  to?: string;
  limit: number;
  cursor?: string;
}

/**
 * Invoices — one per job, id === dealId.
 *
 *   PK = INVOICE#<dealId>, SK = METADATA
 *   GSI1 (ListIndex):    GSI1PK = INVOICES,            GSI1SK = <createdAt>#<id>
 *   GSI2 (ContactIndex): GSI2PK = CONTACT#<contactId>, GSI2SK = INVOICE#<createdAt>#<id>
 *
 * `status` and `sentAt` are filtered with a FilterExpression over the list
 * partition (see the tradeoff note in dynamo.constants.ts). `status` is
 * derived but stored, refreshed on reads, on deal events and by the daily
 * overdue sweep.
 */
@Injectable()
export class InvoicesRepository {
  constructor(private readonly db: DynamoDbService) {}

  async create(invoice: Invoice): Promise<void> {
    try {
      await this.db.client.send(
        new PutCommand({
          TableName: BILLING_TABLE,
          Item: {
            PK: invoicePk(invoice.id),
            SK: METADATA_SK,
            GSI1PK: INVOICES_GSI1PK,
            GSI1SK: listSk(invoice.createdAt, invoice.id),
            GSI2PK: contactGsi2Pk(invoice.contactId),
            GSI2SK: contactGsi2Sk('INVOICE', invoice.createdAt, invoice.id),
            entityType: 'invoice',
            ...invoice,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
    } catch (err) {
      if (isConditionalCheckFailed(err)) throw new InvoiceExistsError();
      throw err;
    }
  }

  async get(id: string): Promise<Invoice | null> {
    const res = await this.db.client.send(
      new GetCommand({ TableName: BILLING_TABLE, Key: { PK: invoicePk(id), SK: METADATA_SK } }),
    );
    return stripKeys<Invoice>(res.Item);
  }

  /**
   * Partial update; bumps `version` unless `bumpVersion: false` (derived
   * snapshot refreshes, which must not turn a concurrent user edit into a
   * conflict). With `expectedVersion` the write is refused
   * (InvoiceVersionConflictError) when someone else wrote in between.
   * A `contactId` change moves the GSI2 key with it.
   */
  async update(
    id: string,
    set: Partial<Invoice> & Record<string, unknown>,
    remove: string[] = [],
    expectedVersion?: number,
    opts: { bumpVersion?: boolean } = {},
  ): Promise<Invoice> {
    const patch: Record<string, unknown> = { ...set };
    if (typeof set.contactId === 'string' && typeof set.createdAt === 'string') {
      patch.GSI2PK = contactGsi2Pk(set.contactId);
      patch.GSI2SK = contactGsi2Sk('INVOICE', set.createdAt, id);
    }
    delete patch.version;
    const expr = buildUpdate(patch, remove, { incrementVersion: opts.bumpVersion !== false });
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
          Key: { PK: invoicePk(id), SK: METADATA_SK },
          ...expr,
          ConditionExpression: conditions.join(' AND '),
          ReturnValues: 'ALL_NEW',
        }),
      );
      return stripKeys<Invoice>(res.Attributes)!;
    } catch (err) {
      if (isConditionalCheckFailed(err)) throw new InvoiceVersionConflictError();
      throw err;
    }
  }

  async delete(id: string): Promise<void> {
    await this.db.client.send(
      new DeleteCommand({ TableName: BILLING_TABLE, Key: { PK: invoicePk(id), SK: METADATA_SK } }),
    );
  }

  async list(filter: InvoiceListFilter): Promise<{ items: Invoice[]; nextCursor?: string }> {
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const filters: string[] = [];

    let input: QueryCommandInput;
    if (filter.contactId) {
      values[':pk'] = contactGsi2Pk(filter.contactId);
      values[':prefix'] = 'INVOICE#';
      input = {
        TableName: BILLING_TABLE,
        IndexName: BILLING_GSI2_NAME,
        KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :prefix)',
      };
      if (filter.from) {
        names['#createdAt'] = 'createdAt';
        values[':from'] = filter.from;
        filters.push('#createdAt >= :from');
      }
      if (filter.to) {
        names['#createdAt'] = 'createdAt';
        values[':to'] = `${filter.to}~`;
        filters.push('#createdAt <= :to');
      }
    } else {
      values[':pk'] = INVOICES_GSI1PK;
      let key = 'GSI1PK = :pk';
      if (filter.from && filter.to) {
        values[':from'] = filter.from;
        values[':to'] = `${filter.to}~`;
        key += ' AND GSI1SK BETWEEN :from AND :to';
      } else if (filter.from) {
        values[':from'] = filter.from;
        key += ' AND GSI1SK >= :from';
      } else if (filter.to) {
        values[':to'] = `${filter.to}~`;
        key += ' AND GSI1SK <= :to';
      }
      input = { TableName: BILLING_TABLE, IndexName: BILLING_GSI1_NAME, KeyConditionExpression: key };
    }

    if (filter.status) {
      names['#status'] = 'status';
      values[':status'] = filter.status;
      filters.push('#status = :status');
    }
    if (filter.unsent) {
      names['#sentAt'] = 'sentAt';
      filters.push('attribute_not_exists(#sentAt)');
    }

    return this.pagedQuery(
      {
        ...input,
        ScanIndexForward: false,
        ExpressionAttributeValues: values,
        ...(Object.keys(names).length && { ExpressionAttributeNames: names }),
        ...(filters.length && { FilterExpression: filters.join(' AND ') }),
      },
      filter.limit,
      filter.cursor,
    );
  }

  /** Every invoice (paged internally) — summary + overdue sweep. */
  async listAll(filterExpression?: {
    expression: string;
    names: Record<string, string>;
    values: Record<string, unknown>;
  }): Promise<Invoice[]> {
    const out: Invoice[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.client.send(
        new QueryCommand({
          TableName: BILLING_TABLE,
          IndexName: BILLING_GSI1_NAME,
          KeyConditionExpression: 'GSI1PK = :pk',
          ExpressionAttributeValues: { ':pk': INVOICES_GSI1PK, ...(filterExpression?.values ?? {}) },
          ...(filterExpression && {
            FilterExpression: filterExpression.expression,
            ExpressionAttributeNames: filterExpression.names,
          }),
          ExclusiveStartKey,
        }),
      );
      for (const i of res.Items ?? []) out.push(stripKeys<Invoice>(i)!);
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
  }

  async listByContact(contactId: string): Promise<Invoice[]> {
    const { items } = await this.list({ contactId, limit: 500 });
    return items;
  }

  /**
   * Fills a page through a FilterExpression: DynamoDB applies `Limit` before
   * the filter, so keep reading until the page is full or the index ends.
   * Asking only for the remaining count keeps the cursor exact.
   */
  private async pagedQuery(
    input: QueryCommandInput,
    limit: number,
    cursor?: string,
  ): Promise<{ items: Invoice[]; nextCursor?: string }> {
    const items: Invoice[] = [];
    let startKey = decodeCursor<Record<string, unknown>>(cursor);
    for (let round = 0; round < 25 && items.length < limit; round++) {
      const res = await this.db.client.send(
        new QueryCommand({ ...input, Limit: limit - items.length, ExclusiveStartKey: startKey }),
      );
      for (const i of res.Items ?? []) items.push(stripKeys<Invoice>(i)!);
      startKey = res.LastEvaluatedKey;
      if (!startKey) break;
    }
    return { items, nextCursor: startKey ? encodeCursor(startKey) : undefined };
  }
}
