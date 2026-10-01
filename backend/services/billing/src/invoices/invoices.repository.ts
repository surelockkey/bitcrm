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
import type { Invoice, InvoiceItem, InvoiceStatus } from '@bitcrm/types';
import {
  ACCOUNT_COUNTERS_PK,
  BILLING_GSI1_NAME,
  BILLING_GSI2_NAME,
  BILLING_TABLE,
  COUNTERS_SK,
  INVOICES_GSI1PK,
  ITEM_SK_PREFIX,
  METADATA_SK,
  contactGsi2Pk,
  contactGsi2Sk,
  estimateItemSk,
  invoicePk,
  listSk,
  stripKeys,
  unpaidIndexKeys,
} from '../common/constants/dynamo.constants';
import { sortItems } from '../estimates/estimate-rules';
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
 * Invoices — a job's (one per job, id === dealId) or a client's (no job, id a uuid).
 *
 *   PK = INVOICE#<id>, SK = METADATA
 *   GSI1 (ListIndex):    GSI1PK = INVOICES,            GSI1SK = <createdAt>#<id>
 *   GSI2 (ContactIndex): GSI2PK = CONTACT#<contactId>, GSI2SK = INVOICE#<createdAt>#<id>
 *   GSI4 (UnpaidIndex):  GSI4PK = UNPAID,             GSI4SK = <id>   only while `due`/`overdue`
 *                                                                          and more than $0.01 owed
 *   PK = INVOICE#<id>, SK = ITEM#<lineId>     a CLIENT invoice's own lines, ordered by `position`
 *                                             (a job invoice has none: its lines are the job's).
 *                                             The ledger's PAYMENT#… rows share the partition.
 *   PK = COUNTERS#ACCOUNT, SK = COUNTERS       `documentSeq` — client documents' numbers
 *
 * The UnpaidIndex keys follow `status` on every write that carries one
 * (create, and any update whose `set` names `status`), so no caller keeps
 * them by hand.
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
            ...unpaidIndexKeys(invoice.id, invoice.status, invoice.totals?.balanceDue),
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
    const removals = [...remove];
    if (typeof set.contactId === 'string' && typeof set.createdAt === 'string') {
      patch.GSI2PK = contactGsi2Pk(set.contactId);
      patch.GSI2SK = contactGsi2Sk('INVOICE', set.createdAt, id);
    }
    // A write that names the status also decides whether the invoice is on
    // UnpaidIndex — a payment and a snapshot refresh alike (they carry the
    // totals, so the balance decides too: a cent or less owed is paid). The
    // overdue sweep names only the status (due → overdue): an open invoice
    // stays exactly where it was, on the index or off it.
    if (typeof set.status === 'string') {
      const balance = set.totals?.balanceDue;
      const keys = unpaidIndexKeys(id, set.status, balance);
      if (!keys) removals.push('GSI4PK', 'GSI4SK');
      else if (typeof balance === 'number') Object.assign(patch, keys);
    }
    delete patch.version;
    const expr = buildUpdate(patch, removals, { incrementVersion: opts.bumpVersion !== false });
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

  /** Removes the invoice and (a client invoice's) line rows. The ledger's PAYMENT# rows stay. */
  async delete(id: string): Promise<void> {
    const items = await this.getItems(id);
    const keys = [
      { PK: invoicePk(id), SK: METADATA_SK },
      ...items.map((i) => ({ PK: invoicePk(id), SK: estimateItemSk(i.lineId) })),
    ];
    if (keys.length === 1) {
      await this.db.client.send(new DeleteCommand({ TableName: BILLING_TABLE, Key: keys[0] }));
      return;
    }
    for (let i = 0; i < keys.length; i += 25) {
      await this.batchWriteWithRetry(keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })));
    }
  }

  // ------------------------------------------------- client invoices' lines

  /**
   * Atomic account-wide counter for a CLIENT invoice's number (no job to take
   * one from); the same counter client estimates use.
   */
  async nextAccountSeq(): Promise<number> {
    const res = await this.db.client.send(
      new UpdateCommand({
        TableName: BILLING_TABLE,
        Key: { PK: ACCOUNT_COUNTERS_PK, SK: COUNTERS_SK },
        UpdateExpression: 'ADD documentSeq :one',
        ExpressionAttributeValues: { ':one': 1 },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    return Number(res.Attributes?.documentSeq ?? 1);
  }

  /** The invoice's own ITEM# rows, in `position` order (none for a job invoice). */
  async getItems(id: string): Promise<InvoiceItem[]> {
    const out: InvoiceItem[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.client.send(
        new QueryCommand({
          TableName: BILLING_TABLE,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: { ':pk': invoicePk(id), ':sk': ITEM_SK_PREFIX },
          ExclusiveStartKey,
        }),
      );
      for (const r of res.Items ?? []) out.push(stripKeys<InvoiceItem>(r)!);
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return sortItems(out);
  }

  async putItem(item: InvoiceItem): Promise<void> {
    await this.db.client.send(
      new PutCommand({
        TableName: BILLING_TABLE,
        Item: { PK: invoicePk(item.invoiceId), SK: estimateItemSk(item.lineId), entityType: 'invoice_item', ...item },
      }),
    );
  }

  async deleteItem(invoiceId: string, lineId: string): Promise<void> {
    await this.db.client.send(
      new DeleteCommand({ TableName: BILLING_TABLE, Key: { PK: invoicePk(invoiceId), SK: estimateItemSk(lineId) } }),
    );
  }

  async setPositions(
    invoiceId: string,
    positions: Array<{ lineId: string; position: number }>,
    now: string,
  ): Promise<void> {
    for (let i = 0; i < positions.length; i += 100) {
      await this.db.client.send(
        new TransactWriteCommand({
          TransactItems: positions.slice(i, i + 100).map((p) => ({
            Update: {
              TableName: BILLING_TABLE,
              Key: { PK: invoicePk(invoiceId), SK: estimateItemSk(p.lineId) },
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

  /**
   * The Query that selects invoices, shared by the list and its count so the
   * two can never answer about different populations.
   */
  private buildListQuery(filter: InvoiceListFilter): QueryCommandInput {
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

    return {
      ...input,
      ScanIndexForward: false,
      ExpressionAttributeValues: values,
      ...(Object.keys(names).length && { ExpressionAttributeNames: names }),
      ...(filters.length && { FilterExpression: filters.join(' AND ') }),
    };
  }

  async list(filter: InvoiceListFilter): Promise<{ items: Invoice[]; nextCursor?: string }> {
    return this.pagedQuery(this.buildListQuery(filter), filter.limit, filter.cursor);
  }

  /**
   * How many invoices the filter selects — the number behind "Page 2 of 7".
   *
   * The same Query, with `Select: 'COUNT'`: no invoice bodies come back, only
   * the tally. Bounded, because a status filter is applied after the read and
   * a rare status over the whole ledger would otherwise walk all of it.
   */
  async count(filter: InvoiceListFilter): Promise<CountRowsResult> {
    const input = this.buildListQuery(filter);

    return countRows((page) =>
      this.db.client.send(new QueryCommand({ ...input, Select: 'COUNT', ...page })),
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
