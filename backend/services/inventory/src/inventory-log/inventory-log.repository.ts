import { Injectable } from '@nestjs/common';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  DynamoDbService,
  scanPage,
  countRows,
  type CountRowsResult,
} from '@bitcrm/shared';
import { type InventoryLogAction, type InventoryLogEntry } from '@bitcrm/types';
import { INVENTORY_TABLE, GSI4_NAME } from '../common/constants/dynamo.constants';
import {
  invlogMonth,
  invlogPartition,
  invlogProductPartition,
  invlogSearchText,
  invlogSortKey,
} from './inventory-log.constants';

/** The ISO window a read covers, both ends inclusive. */
export interface InventoryLogWindow {
  from: string;
  to: string;
}

export interface InventoryLogFilters {
  userId?: string;
  action?: InventoryLogAction;
  search?: string;
}

export interface InventoryLogPage {
  items: InventoryLogEntry[];
  lastKey?: Record<string, unknown>;
  /** DynamoDB reads this page cost — what the service's budget is charged. */
  reads: number;
}

/** Key attributes that must never leak into an entry. */
const KEY_ATTRIBUTES = new Set(['PK', 'SK', 'GSI4PK', 'GSI4SK', 'searchText']);

/**
 * Inventory audit-log rows in the single BitCRM_Inventory table:
 *   PK = INVLOG#<YYYY-MM> (UTC month of createdAt), SK = <createdAt ISO>#<id>
 *   GSI4PK = INVLOG#PRODUCT#<productId>, GSI4SK = <createdAt ISO>#<id>
 *     (one item's history, on TransferEntityIndex; sparse — an item-less
 *     entry such as `container_assigned` has neither key and lives in the
 *     month walk only)
 *   searchText = lowercased "<productName> <sku>", for the contains filter;
 *     the subject user's name on an item-less entry
 *
 * Rows are written once and never updated. A month is read with one Query;
 * the service walks months to fill a page across them.
 */
@Injectable()
export class InventoryLogRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async create(entry: InventoryLogEntry): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: INVENTORY_TABLE,
        Item: {
          PK: invlogPartition(invlogMonth(entry.createdAt)),
          SK: invlogSortKey(entry.createdAt, entry.id),
          // An item-less entry has no item history to join.
          ...(entry.productId && {
            GSI4PK: invlogProductPartition(entry.productId),
            GSI4SK: invlogSortKey(entry.createdAt, entry.id),
          }),
          searchText: invlogSearchText(entry.productName ?? entry.subjectUserName, entry.sku),
          ...entry,
        },
      }),
    );
  }

  /**
   * One month partition, newest first, bounded by the window. `maxReads` is
   * what is left of the caller's read budget: a filtered read fills the page
   * across DynamoDB pages and must not spend more than that.
   */
  async queryMonth(
    month: string,
    window: InventoryLogWindow,
    filters: InventoryLogFilters,
    limit: number,
    startKey?: Record<string, unknown>,
    maxReads?: number,
  ): Promise<InventoryLogPage> {
    return this.query(
      {
        KeyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :to',
        ExpressionAttributeValues: { ':pk': invlogPartition(month), ...this.windowValues(window) },
      },
      filters,
      limit,
      startKey,
      (item) => ({ PK: item.PK, SK: item.SK }),
      maxReads,
    );
  }

  /** One product's history off GSI4, newest first, bounded by the window. */
  async queryProduct(
    productId: string,
    window: InventoryLogWindow,
    filters: InventoryLogFilters,
    limit: number,
    startKey?: Record<string, unknown>,
  ): Promise<InventoryLogPage> {
    return this.query(
      {
        IndexName: GSI4_NAME,
        KeyConditionExpression: 'GSI4PK = :pk AND GSI4SK BETWEEN :from AND :to',
        ExpressionAttributeValues: {
          ':pk': invlogProductPartition(productId),
          ...this.windowValues(window),
        },
      },
      filters,
      limit,
      startKey,
      (item) => ({ PK: item.PK, SK: item.SK, GSI4PK: item.GSI4PK, GSI4SK: item.GSI4SK }),
    );
  }

  /** How many rows one month holds under the window and filters, without bodies. */
  async countMonth(
    month: string,
    window: InventoryLogWindow,
    filters: InventoryLogFilters,
  ): Promise<CountRowsResult> {
    return this.count(
      {
        KeyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :to',
        ExpressionAttributeValues: { ':pk': invlogPartition(month), ...this.windowValues(window) },
      },
      filters,
    );
  }

  /** How many rows one product's history holds under the window and filters, off GSI4. */
  async countProduct(
    productId: string,
    window: InventoryLogWindow,
    filters: InventoryLogFilters,
  ): Promise<CountRowsResult> {
    return this.count(
      {
        IndexName: GSI4_NAME,
        KeyConditionExpression: 'GSI4PK = :pk AND GSI4SK BETWEEN :from AND :to',
        ExpressionAttributeValues: {
          ':pk': invlogProductPartition(productId),
          ...this.windowValues(window),
        },
      },
      filters,
    );
  }

  private async count(
    base: {
      IndexName?: string;
      KeyConditionExpression: string;
      ExpressionAttributeValues: Record<string, unknown>;
    },
    filters: InventoryLogFilters,
  ): Promise<CountRowsResult> {
    const filter = this.filterParts(filters);
    return countRows((input) =>
      this.dynamoDb.client.send(
        new QueryCommand({
          TableName: INVENTORY_TABLE,
          ...base,
          ExpressionAttributeValues: { ...base.ExpressionAttributeValues, ...filter.values },
          ...(filter.expression && {
            FilterExpression: filter.expression,
            ExpressionAttributeNames: filter.names,
          }),
          Select: 'COUNT',
          ...input,
        }),
      ),
    );
  }

  /**
   * An unfiltered Query is a page in itself. A filtered one is not — `Limit`
   * caps rows read, the filter runs afterwards — so it fills the page the way
   * a filtered Scan does, within the reads it was given.
   */
  private async query(
    base: {
      IndexName?: string;
      KeyConditionExpression: string;
      ExpressionAttributeValues: Record<string, unknown>;
    },
    filters: InventoryLogFilters,
    limit: number,
    startKey: Record<string, unknown> | undefined,
    keyOf: (item: Record<string, unknown>) => Record<string, unknown>,
    maxReads?: number,
  ): Promise<InventoryLogPage> {
    const filter = this.filterParts(filters);
    let reads = 0;
    const read = (input: { Limit: number; ExclusiveStartKey?: Record<string, unknown> }) => {
      reads += 1;
      return this.dynamoDb.client.send(
        new QueryCommand({
          TableName: INVENTORY_TABLE,
          ...base,
          ExpressionAttributeValues: { ...base.ExpressionAttributeValues, ...filter.values },
          ...(filter.expression && {
            FilterExpression: filter.expression,
            ExpressionAttributeNames: filter.names,
          }),
          ScanIndexForward: false,
          ...input,
        }),
      );
    };

    if (!filter.expression) {
      const result = await read({
        Limit: limit,
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      });
      return {
        items: (result.Items ?? []).map((item) => this.toEntry(item)),
        lastKey: result.LastEvaluatedKey,
        reads,
      };
    }

    const page = await scanPage<Record<string, unknown>>(read, limit, {
      startKey,
      keyOf,
      ...(maxReads !== undefined && { maxReads }),
    });
    return { items: page.items.map((item) => this.toEntry(item)), lastKey: page.lastKey, reads };
  }

  /**
   * `to` gains a `#~` suffix so a row written in the very millisecond of `to`
   * (SK `<to>#<id>`) still falls inside the window.
   */
  private windowValues(window: InventoryLogWindow): Record<string, string> {
    return { ':from': window.from, ':to': `${window.to}#~` };
  }

  private filterParts(filters: InventoryLogFilters): {
    expression?: string;
    names?: Record<string, string>;
    values: Record<string, unknown>;
  } {
    const parts: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};

    if (filters.userId) {
      parts.push('userId = :userId');
      values[':userId'] = filters.userId;
    }
    if (filters.action) {
      // `action` is a DynamoDB reserved word.
      parts.push('#action = :action');
      names['#action'] = 'action';
      values[':action'] = filters.action;
    }
    if (filters.search?.trim()) {
      parts.push('contains(searchText, :search)');
      values[':search'] = filters.search.trim().toLowerCase();
    }

    if (parts.length === 0) return { values };
    return {
      expression: parts.join(' AND '),
      names: Object.keys(names).length > 0 ? names : undefined,
      values,
    };
  }

  private toEntry(item: Record<string, unknown>): InventoryLogEntry {
    const entry: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      if (!KEY_ATTRIBUTES.has(key)) entry[key] = value;
    }
    return entry as unknown as InventoryLogEntry;
  }
}
