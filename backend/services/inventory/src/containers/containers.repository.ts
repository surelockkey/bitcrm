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
import { type Container, type InventoryStatus } from '@bitcrm/types';
import {
  INVENTORY_TABLE,
  GSI1_NAME,
  GSI3_NAME,
} from '../common/constants/dynamo.constants';
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
  items: Container[];
  nextCursor?: string;
}

export interface ContainerListFilters {
  department?: string;
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
 * Container rows in the single BitCRM_Inventory table:
 *   PK = CONTAINER#<id>, SK = METADATA
 *   GSI1PK = LOCATION#CONTAINER, GSI1SK = <name lowercased>#<id>   (list index, name order)
 *   GSI3PK = OWNER#<technicianId>, GSI3SK = CONTAINER#<id>          (sparse: the legacy single-technician
 *                                                                    link; who works from a van is
 *                                                                    USER_CONTAINER# rows on
 *                                                                    CONTAINER_USERS#<id>, same index)
 *   searchName = <name lowercased>                                   (what the search filter matches)
 */
@Injectable()
export class ContainersRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async create(container: Container): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: INVENTORY_TABLE,
        Item: {
          // Spread first, then override: extra attributes the Workiz import
          // carries (`externalId`, `isPrimary`, `userLimited`, `accessUserIds`)
          // are kept, but the keys are always this repository's.
          ...container,
          PK: `CONTAINER#${container.id}`,
          SK: 'METADATA',
          GSI1PK: LOCATION_INDEX_PK.container,
          GSI1SK: locationSortKey(container.name, container.id),
          searchName: locationSearchName(container.name),
          // Sparse GSI: only assigned containers appear in the by-technician index.
          ...(container.technicianId
            ? {
                GSI3PK: `OWNER#${container.technicianId}`,
                GSI3SK: `CONTAINER#${container.id}`,
              }
            : {}),
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }

  async findById(id: string): Promise<Container | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `CONTAINER#${id}`, SK: 'METADATA' },
      }),
    );

    if (!result.Item) return null;
    return this.toContainer(result.Item);
  }

  async findByTechnicianId(technicianId: string): Promise<Container | null> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: INVENTORY_TABLE,
        IndexName: GSI3_NAME,
        KeyConditionExpression: 'GSI3PK = :pk',
        ExpressionAttributeValues: { ':pk': `OWNER#${technicianId}` },
        Limit: 1,
      }),
    );

    const items = result.Items || [];
    if (items.length === 0) return null;
    return this.toContainer(items[0]);
  }

  /**
   * The Query that selects containers, shared by the list and its count so the
   * two can never answer about different populations.
   */
  private listQuery(filters?: ContainerListFilters) {
    const filterParts: string[] = [];
    const values: Record<string, unknown> = { ':pk': LOCATION_INDEX_PK.container };
    const names: Record<string, string> = {};

    if (filters?.department) {
      filterParts.push('#department = :dept');
      names['#department'] = 'department';
      values[':dept'] = filters.department;
    }
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

  /** How many containers the list holds — the number behind "Page 2 of 7". */
  async countAll(filters?: ContainerListFilters): Promise<CountRowsResult> {
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
    filters?: ContainerListFilters,
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
      items: page.items.map(this.toContainer),
      nextCursor: encodeIndexCursor(page.lastKey),
    };
  }

  /**
   * `technicianId: null` unassigns (removes the attribute and the GSI keys, so
   * the container drops out of the by-technician index); a string reassigns and
   * rewrites the GSI keys. `undefined` leaves assignment untouched. A new name
   * rewrites the list index sort key and the search name.
   *
   * Whatever changed, a row the list index does not hold (written before the
   * index existed) leaves here indexed: any edit heals it, not only a rename.
   */
  async update(
    id: string,
    attrs: Partial<{ [K in keyof Container]: Container[K] | null }>,
  ): Promise<Container> {
    const setParts: string[] = [];
    const removeParts: string[] = [];
    const expressionNames: Record<string, string> = {};
    const expressionValues: Record<string, unknown> = {};

    const updates: Record<string, unknown> = {
      ...attrs,
      updatedAt: new Date().toISOString(),
    };
    if (typeof attrs.name === 'string') {
      updates.GSI1PK = LOCATION_INDEX_PK.container;
      updates.GSI1SK = locationSortKey(attrs.name, id);
      updates.searchName = locationSearchName(attrs.name);
    }
    if (typeof attrs.technicianId === 'string') {
      updates.GSI3PK = `OWNER#${attrs.technicianId}`;
      updates.GSI3SK = `CONTAINER#${id}`;
    } else if (attrs.technicianId === null) {
      updates.GSI3PK = null;
      updates.GSI3SK = null;
    }
    const immutableKeys = new Set(['id']);

    for (const [key, value] of Object.entries(updates)) {
      if (immutableKeys.has(key) || value === undefined) continue;
      const attrName = `#${key}`;
      expressionNames[attrName] = key;
      if (value === null) {
        removeParts.push(attrName);
      } else {
        const attrValue = `:${key}`;
        setParts.push(`${attrName} = ${attrValue}`);
        expressionValues[attrValue] = value;
      }
    }

    const updateExpression = [
      `SET ${setParts.join(', ')}`,
      ...(removeParts.length > 0 ? [`REMOVE ${removeParts.join(', ')}`] : []),
    ].join(' ');

    const result = await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `CONTAINER#${id}`, SK: 'METADATA' },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: expressionValues,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );

    const row = result.Attributes!;
    await this.healIndexKeys(row);
    return this.toContainer(row);
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
   * (`externalId`, `isPrimary`, `userLimited`, `accessUserIds` — 59 of the 86
   * locations have a technician and 7 carry secondary users). The typed fields
   * are written after the spread so they always win, and the DynamoDB key
   * attributes never leak out.
   */
  private toContainer(item: Record<string, unknown>): Container {
    const technicianName = item.technicianName as string | undefined;
    const extras: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      if (!KEY_ATTRIBUTES.has(key)) extras[key] = value;
    }
    return {
      ...extras,
      id: item.id as string,
      // Rows written before containers had their own name fall back to the
      // technician-derived label they were always displayed with.
      name:
        (item.name as string | undefined) ??
        (technicianName ? `${technicianName}'s van` : 'Container'),
      description: item.description as string | undefined,
      technicianId: item.technicianId as string | undefined,
      technicianName,
      department: item.department as string | undefined,
      templateId: item.templateId as string | undefined,
      status: item.status as Container['status'],
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    };
  }
}
