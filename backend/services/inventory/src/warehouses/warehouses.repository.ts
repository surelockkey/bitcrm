import { Injectable } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  DynamoDbService,
  scanPage,
  countRows,
  type CountRowsResult,
} from '@bitcrm/shared';
import { type Warehouse, type InventoryStatus } from '@bitcrm/types';
import { INVENTORY_TABLE, GSI1_NAME } from '../common/constants/dynamo.constants';
import {
  LOCATION_INDEX_PK,
  locationSearchName,
  locationSortKey,
} from '../common/constants/locations.constants';
import { decodeIndexCursor, encodeIndexCursor } from '../common/utils/index-cursor';
import {
  locationIndexKeysToWrite,
  type LocationIndexRow,
} from '../stock/location-index.backfill';

export interface PaginatedResult {
  items: Warehouse[];
  nextCursor?: string;
}

export interface WarehouseListFilters {
  /** Matched against the lowercased name (`searchName`), never the id. */
  search?: string;
  status?: InventoryStatus;
}

/** Key and derived attributes that must never leak onto an entity or be taken from one. */
const KEY_ATTRIBUTES = new Set([
  'PK', 'SK', 'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK', 'GSI3PK', 'GSI3SK', 'GSI4PK', 'GSI4SK',
  'searchName',
]);

/** A cursor of the list Query names the table keys and the index keys. */
const LIST_CURSOR_KEYS = ['PK', 'SK', 'GSI1PK', 'GSI1SK'] as const;

/**
 * Warehouse rows in the single BitCRM_Inventory table:
 *   PK = WAREHOUSE#<id>, SK = METADATA
 *   GSI1PK = LOCATION#WAREHOUSE, GSI1SK = <name lowercased>#<id>   (list index, name order)
 *   searchName = <name lowercased>                                  (what the search filter matches)
 */
@Injectable()
export class WarehousesRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async create(warehouse: Warehouse): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: INVENTORY_TABLE,
        Item: {
          // Spread first, then override: the importer's extra attributes
          // (`externalId`, `isPrimary`) are kept, the keys are always ours.
          ...warehouse,
          PK: `WAREHOUSE#${warehouse.id}`,
          SK: 'METADATA',
          GSI1PK: LOCATION_INDEX_PK.warehouse,
          GSI1SK: locationSortKey(warehouse.name, warehouse.id),
          searchName: locationSearchName(warehouse.name),
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }

  async findById(id: string): Promise<Warehouse | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `WAREHOUSE#${id}`, SK: 'METADATA' },
      }),
    );

    if (!result.Item) return null;
    return this.toWarehouse(result.Item);
  }

  /**
   * The Query that selects warehouses, shared by the list and its count so the
   * two can never answer about different populations.
   */
  private listQuery(filters?: WarehouseListFilters) {
    const filterParts: string[] = [];
    const values: Record<string, unknown> = { ':pk': LOCATION_INDEX_PK.warehouse };
    const names: Record<string, string> = {};

    if (filters?.status) {
      filterParts.push('#status = :status');
      names['#status'] = 'status';
      values[':status'] = filters.status;
    }
    if (filters?.search?.trim()) {
      // Never `contains(GSI1SK, …)`: the sort key ends in the UUID, and a
      // term of digits or a–f would match the id of nearly every row.
      filterParts.push('contains(searchName, :search)');
      values[':search'] = locationSearchName(filters.search);
    }

    return {
      TableName: INVENTORY_TABLE,
      IndexName: GSI1_NAME,
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: values,
      ...(filterParts.length > 0 && { FilterExpression: filterParts.join(' AND ') }),
      ...(Object.keys(names).length > 0 && { ExpressionAttributeNames: names }),
    };
  }

  /** How many warehouses the list holds — the number behind "Page 2 of 7". */
  async countAll(filters?: WarehouseListFilters): Promise<CountRowsResult> {
    const query = this.listQuery(filters);

    return countRows((input) =>
      this.dynamoDb.client.send(
        new QueryCommand({ ...query, Select: 'COUNT', ...input }),
      ),
    );
  }

  async findAll(
    limit: number,
    cursor?: string,
    filters?: WarehouseListFilters,
  ): Promise<PaginatedResult> {
    const query = this.listQuery(filters);
    // Decoded before any read: a stale or foreign cursor is a 400, not a 500.
    const startKey = decodeIndexCursor(cursor, LIST_CURSOR_KEYS);

    // З фільтром Query, як і Scan, рахує в `Limit` прочитане, а не знайдене,
    // тож сторінку дочитуємо. Курсор на GSI-запиті несе і ключі таблиці, і
    // ключі індексу.
    const page = await scanPage<Record<string, unknown>>(
      (input) =>
        this.dynamoDb.client.send(
          new QueryCommand({ ...query, ScanIndexForward: true, ...input }),
        ),
      limit,
      {
        startKey,
        keyOf: (i) => ({ PK: i.PK, SK: i.SK, GSI1PK: i.GSI1PK, GSI1SK: i.GSI1SK }),
      },
    );

    return {
      items: page.items.map(this.toWarehouse),
      nextCursor: encodeIndexCursor(page.lastKey),
    };
  }

  /**
   * A new name rewrites the list index sort key and the search name. Whatever
   * changed, a row the list index does not hold (written before the index
   * existed) leaves here indexed: any edit heals it, not only a rename.
   */
  async update(id: string, attrs: Partial<Warehouse>): Promise<Warehouse> {
    const setParts: string[] = [];
    const expressionNames: Record<string, string> = {};
    const expressionValues: Record<string, unknown> = {};

    const updates: Record<string, unknown> = {
      ...attrs,
      updatedAt: new Date().toISOString(),
    };
    if (typeof attrs.name === 'string') {
      updates.GSI1PK = LOCATION_INDEX_PK.warehouse;
      updates.GSI1SK = locationSortKey(attrs.name, id);
      updates.searchName = locationSearchName(attrs.name);
    }
    const immutableKeys = new Set(['id']);

    for (const [key, value] of Object.entries(updates)) {
      if (immutableKeys.has(key) || value === undefined) continue;
      const attrName = `#${key}`;
      const attrValue = `:${key}`;
      expressionNames[attrName] = key;
      setParts.push(`${attrName} = ${attrValue}`);
      expressionValues[attrValue] = value;
    }

    const result = await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `WAREHOUSE#${id}`, SK: 'METADATA' },
        UpdateExpression: `SET ${setParts.join(', ')}`,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: expressionValues,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );

    const row = result.Attributes!;
    await this.healIndexKeys(row);
    return this.toWarehouse(row);
  }

  /** Give a row the list index keys it lacks — the same decision the backfill script makes. */
  private async healIndexKeys(row: Record<string, unknown>): Promise<void> {
    const keys = locationIndexKeysToWrite(row as unknown as LocationIndexRow);
    if (!keys) return;
    await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: row.PK, SK: row.SK },
        UpdateExpression: 'SET GSI1PK = :pk, GSI1SK = :sk, searchName = :name',
        ExpressionAttributeValues: { ':pk': keys.GSI1PK, ':sk': keys.GSI1SK, ':name': keys.searchName },
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  }

  /**
   * Stored row → entity, keeping the attributes the Workiz import adds
   * (`externalId`, `isPrimary` — 1 of the 3 warehouses is the primary STORE).
   * Typed fields are written after the spread so they always win.
   */
  private toWarehouse(item: Record<string, unknown>): Warehouse {
    const extras: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      if (!KEY_ATTRIBUTES.has(key)) extras[key] = value;
    }
    return {
      ...extras,
      id: item.id as string,
      name: item.name as string,
      address: item.address as string | undefined,
      description: item.description as string | undefined,
      status: item.status as Warehouse['status'],
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    };
  }
}
