import { Injectable } from '@nestjs/common';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  DynamoDbService,
  countRows,
  type CountRowsResult,
} from '@bitcrm/shared';
import { fillPage } from '../common/utils/fill-page';
import { FilterBuilder, type FilterParts } from '../common/utils/filter-expression';
import { InventoryLogAction, type InventoryLogEntry } from '@bitcrm/types';
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
  /** One user or any of several. */
  userId?: string | string[];
  /** Matched against `fromId` OR `toId`. */
  locationId?: string | string[];
  /** The entry's item-category snapshot. */
  category?: string | string[];
  /** The entry's brand snapshot. */
  brandId?: string | string[];
  action?: InventoryLogAction;
  search?: string;
}

export interface InventoryLogPage {
  items: InventoryLogEntry[];
  lastKey?: Record<string, unknown>;
  /** DynamoDB reads this page cost — what the service's budget is charged. */
  reads: number;
}

/** Rows read per page, and pages at most, when looking up where a job's units came from. */
const LATEST_USE_PAGE = 100;
const LATEST_USE_MAX_READS = 5;

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

  /**
   * The newest `stock_used` entry of one item for one job — where a job line's
   * units were taken from, so a restore puts them back there. Walks the item's
   * GSI4 history newest first, a bounded number of reads; null when none of
   * them holds one (a deduct older than the log, or a very busy item).
   */
  async findLatestStockUse(productId: string, dealId: string): Promise<InventoryLogEntry | null> {
    let key: Record<string, unknown> | undefined;
    for (let read = 0; read < LATEST_USE_MAX_READS; read++) {
      const page = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: INVENTORY_TABLE,
          IndexName: GSI4_NAME,
          KeyConditionExpression: 'GSI4PK = :pk',
          FilterExpression: '#action = :action AND dealId = :dealId',
          ExpressionAttributeNames: { '#action': 'action' },
          ExpressionAttributeValues: {
            ':pk': invlogProductPartition(productId),
            ':action': InventoryLogAction.STOCK_USED,
            ':dealId': dealId,
          },
          ScanIndexForward: false,
          Limit: LATEST_USE_PAGE,
          ...(key ? { ExclusiveStartKey: key } : {}),
        }),
      );
      const match = page.Items?.[0];
      if (match) return this.toEntry(match);
      key = page.LastEvaluatedKey;
      if (!key) return null;
    }
    return null;
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

    const page = await fillPage<Record<string, unknown>>(read, limit, {
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

  private filterParts(filters: InventoryLogFilters): FilterParts {
    const builder = new FilterBuilder()
      .equalsAny('userId', filters.userId)
      .eitherEqualsAny(['fromId', 'toId'], filters.locationId, 'locationId')
      .equalsAny('category', filters.category)
      .equalsAny('brandId', filters.brandId);
    // `action` is a DynamoDB reserved word.
    if (filters.action) builder.raw('#action = :action', { ':action': filters.action }, { '#action': 'action' });
    if (filters.search?.trim()) {
      builder.raw('contains(searchText, :search)', { ':search': filters.search.trim().toLowerCase() });
    }
    return builder.build();
  }

  private toEntry(item: Record<string, unknown>): InventoryLogEntry {
    const entry: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      if (!KEY_ATTRIBUTES.has(key)) entry[key] = value;
    }
    return entry as unknown as InventoryLogEntry;
  }
}
