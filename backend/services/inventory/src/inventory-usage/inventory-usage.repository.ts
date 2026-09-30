import { Injectable } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { INVENTORY_TABLE } from '../common/constants/dynamo.constants';
import { usagePointerKey, usageSearchText } from './inventory-usage.constants';
import {
  type StoredUsageRow,
  type UsageKey,
  type UsageRow,
} from './inventory-usage.types';

/**
 * A write lost a race: the row moved, or changed since it was read. The
 * projection service reads again and retries.
 */
export class UsageConflictError extends Error {
  constructor(message = 'Usage row changed meanwhile') {
    super(message);
    this.name = 'UsageConflictError';
  }
}

/** One use, added to a row that exists. */
export interface UsageUseChange {
  qty: number;
  containerId: string;
  at: string;
  productName: string;
  sku?: string;
  number?: number;
  category?: string;
  brandId?: string;
  unitPrice?: number;
  unitCost?: number;
}

/** A pointer, with the product it is for. */
export type UsagePointer = UsageKey & { productId: string };

/** Attributes that are keys or derived, never part of a row handed out. */
const INTERNAL_ATTRIBUTES = new Set(['PK', 'SK', 'searchText', 'lastRestoredAt']);

/**
 * `SET` clauses with every attribute aliased — `number` and `source` are
 * DynamoDB reserved words — and undefined values left out rather than written.
 */
class SetClauses {
  readonly names: Record<string, string> = {};
  private readonly clauses: string[] = [];

  constructor(private readonly values: Record<string, unknown>) {}

  add(attr: string, value: unknown, ifNotExists = false): void {
    if (value === undefined) return;
    const name = `#${attr}`;
    this.names[name] = attr;
    this.values[`:${attr}`] = value;
    this.clauses.push(ifNotExists ? `${name} = if_not_exists(${name}, :${attr})` : `${name} = :${attr}`);
  }

  expression(): string {
    return this.clauses.join(', ');
  }
}

function isConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'ConditionalCheckFailedException' || error.name === 'TransactionCanceledException')
  );
}

/**
 * The inventory-usage projection in the single BitCRM_Inventory table:
 *
 *   PK = USAGE#<YYYY-MM of the job date>, SK = <jobDate>#<dealId>#<productId>
 *     one row per (job, product): the net units used, the job and item
 *     snapshots the report shows and filters on, `searchText` (lowercased
 *     item name, SKU, job number, client) for the contains filter, and
 *     `containerIds` as a String Set (ADD-able)
 *   PK = USAGE_OF#<dealId>, SK = PRODUCT#<productId>
 *     the pointer: `usagePK` / `usageSK` name where that row lives now, so
 *     a restore or a reschedule finds it in one read
 *
 * A row moves (new month / sort key) when its job is rescheduled: Put the new
 * row, Delete the old one guarded on the quantity it was read with, repoint —
 * one transaction. Uses and restores are `ADD qty` on the row the pointer
 * names, guarded on `attribute_exists(PK)` so one that raced a move is a
 * conflict to retry, never a stray row under the old key.
 */
@Injectable()
export class InventoryUsageRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async getPointer(dealId: string, productId: string): Promise<UsageKey | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({ TableName: INVENTORY_TABLE, Key: usagePointerKey(dealId, productId), ConsistentRead: true }),
    );
    const item = result.Item;
    if (!item || typeof item.usagePK !== 'string' || typeof item.usageSK !== 'string') return null;
    return { PK: item.usagePK, SK: item.usageSK };
  }

  /** Every product the job has a row for, and where each lives. */
  async listPointers(dealId: string): Promise<UsagePointer[]> {
    const pointers: UsagePointer[] = [];
    let key: Record<string, unknown> | undefined;
    do {
      const page = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: INVENTORY_TABLE,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': usagePointerKey(dealId, '').PK },
          ConsistentRead: true,
          ...(key && { ExclusiveStartKey: key }),
        }),
      );
      for (const item of page.Items ?? []) {
        if (typeof item.usagePK !== 'string' || typeof item.usageSK !== 'string') continue;
        pointers.push({ productId: String(item.productId), PK: item.usagePK, SK: item.usageSK });
      }
      key = page.LastEvaluatedKey;
    } while (key);
    return pointers;
  }

  async getRow(key: UsageKey): Promise<StoredUsageRow | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({ TableName: INVENTORY_TABLE, Key: { PK: key.PK, SK: key.SK }, ConsistentRead: true }),
    );
    return result.Item ? { ...this.toRow(result.Item), PK: key.PK, SK: key.SK } : null;
  }

  /**
   * A job's first use of an item: the row (ADD qty, so two first uses at once
   * add up instead of overwriting) and its pointer, in one transaction. The
   * pointer may only be new or already name this row — or name `replaces`, a
   * row that no longer exists. Anything else is a conflict.
   */
  async create(row: StoredUsageRow, replaces?: UsageKey): Promise<void> {
    const values: Record<string, unknown> = { ':qty': row.qty };
    const { PK, SK, qty: _qty, containerIds, ...rest } = row;
    const sets = new SetClauses(values);
    for (const [attr, value] of Object.entries(rest)) {
      sets.add(attr, value, attr === 'firstUsedAt' || attr === 'source');
    }
    sets.add('searchText', usageSearchText(row));

    const adds = ['qty :qty'];
    if (containerIds.length > 0) {
      adds.push('containerIds :containerIds');
      values[':containerIds'] = new Set(containerIds);
    }

    try {
      await this.dynamoDb.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: INVENTORY_TABLE,
                Key: { PK, SK },
                UpdateExpression: `ADD ${adds.join(', ')} SET ${sets.expression()}`,
                ExpressionAttributeNames: sets.names,
                ExpressionAttributeValues: values,
              },
            },
            { Put: this.pointerPut(row, replaces) },
          ],
        }),
      );
    } catch (error) {
      if (isConflict(error)) throw new UsageConflictError();
      throw error;
    }
  }

  /** Another use of an item the job already has a row for. */
  async addUse(key: UsageKey, change: UsageUseChange): Promise<void> {
    const values: Record<string, unknown> = {
      ':qty': change.qty,
      ':containerIds': new Set([change.containerId]),
    };
    const sets = new SetClauses(values);
    sets.add('lastUsedAt', change.at);
    for (const attr of ['productName', 'sku', 'number', 'category', 'brandId', 'unitPrice', 'unitCost'] as const) {
      sets.add(attr, change[attr]);
    }

    await this.update({
      Key: { PK: key.PK, SK: key.SK },
      UpdateExpression: `ADD qty :qty, containerIds :containerIds SET ${sets.expression()}`,
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: sets.names,
      ExpressionAttributeValues: values,
    });
  }

  /** Units a job gave back. The row stays at 0 (or below) — the report hides it. */
  async addRestore(key: UsageKey, qty: number, at: string): Promise<void> {
    await this.update({
      Key: { PK: key.PK, SK: key.SK },
      UpdateExpression: 'ADD qty :qty SET lastRestoredAt = :at',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeValues: { ':qty': -qty, ':at': at },
    });
  }

  /**
   * Rewrite `current` as `next`: in place when the key stays (the client or
   * the technicians changed), else Put the new row, Delete the old one and
   * repoint in one transaction (the job was rescheduled). Both guarded on the
   * quantity `current` was read with, so a use that landed meanwhile is a
   * conflict to retry rather than lost.
   */
  async replace(current: StoredUsageRow, next: StoredUsageRow): Promise<void> {
    const item = this.toItem(next);
    const guard = { ConditionExpression: 'qty = :qty', ExpressionAttributeValues: { ':qty': current.qty } };
    try {
      if (current.PK === next.PK && current.SK === next.SK) {
        await this.dynamoDb.client.send(new PutCommand({ TableName: INVENTORY_TABLE, Item: item, ...guard }));
        return;
      }
      await this.dynamoDb.client.send(
        new TransactWriteCommand({
          TransactItems: [
            { Put: { TableName: INVENTORY_TABLE, Item: item } },
            { Delete: { TableName: INVENTORY_TABLE, Key: { PK: current.PK, SK: current.SK }, ...guard } },
            { Put: { TableName: INVENTORY_TABLE, Item: this.pointerItem(next) } },
          ],
        }),
      );
    } catch (error) {
      if (isConflict(error)) throw new UsageConflictError();
      throw error;
    }
  }

  private async update(input: {
    Key: UsageKey;
    UpdateExpression: string;
    ConditionExpression: string;
    ExpressionAttributeNames?: Record<string, string>;
    ExpressionAttributeValues: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.dynamoDb.client.send(new UpdateCommand({ TableName: INVENTORY_TABLE, ...input }));
    } catch (error) {
      if (isConflict(error)) throw new UsageConflictError();
      throw error;
    }
  }

  private pointerItem(row: StoredUsageRow): Record<string, unknown> {
    return {
      ...usagePointerKey(row.dealId, row.productId),
      dealId: row.dealId,
      productId: row.productId,
      usagePK: row.PK,
      usageSK: row.SK,
    };
  }

  private pointerPut(row: StoredUsageRow, replaces?: UsageKey) {
    if (replaces) {
      return {
        TableName: INVENTORY_TABLE,
        Item: this.pointerItem(row),
        ConditionExpression: 'attribute_not_exists(PK) OR (usagePK = :oldPK AND usageSK = :oldSK)',
        ExpressionAttributeValues: { ':oldPK': replaces.PK, ':oldSK': replaces.SK },
      };
    }
    return {
      TableName: INVENTORY_TABLE,
      Item: this.pointerItem(row),
      ConditionExpression: 'attribute_not_exists(PK) OR (usagePK = :usagePK AND usageSK = :usageSK)',
      ExpressionAttributeValues: { ':usagePK': row.PK, ':usageSK': row.SK },
    };
  }

  /** A row as stored: containers as a String Set (none when empty), search text derived. */
  private toItem(row: StoredUsageRow): Record<string, unknown> {
    const { containerIds, ...rest } = row;
    const item: Record<string, unknown> = { ...rest, searchText: usageSearchText(row) };
    if (containerIds.length > 0) item.containerIds = new Set(containerIds);
    for (const [key, value] of Object.entries(item)) if (value === undefined) delete item[key];
    return item;
  }

  /** A stored item as a row: sets become sorted lists, keys and derived attributes stay behind. */
  toRow(item: Record<string, unknown>): UsageRow {
    const row: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      if (!INTERNAL_ATTRIBUTES.has(key)) row[key] = value;
    }
    row.containerIds = this.stringList(item.containerIds);
    row.techIds = this.stringList(item.techIds, false);
    return row as unknown as UsageRow;
  }

  private stringList(value: unknown, sort = true): string[] {
    const list =
      value instanceof Set ? [...value] : Array.isArray(value) ? value : [];
    const strings = list.filter((v): v is string => typeof v === 'string');
    return sort ? strings.sort() : strings;
  }
}
