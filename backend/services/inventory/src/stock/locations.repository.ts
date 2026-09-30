import { BadRequestException, Injectable } from '@nestjs/common';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import {
  LocationType,
  type InventoryStatus,
  type LocationSummary,
  type LocationSummaryType,
} from '@bitcrm/types';
import { INVENTORY_TABLE, GSI1_NAME } from '../common/constants/dynamo.constants';
import {
  LOCATION_INDEX_PK,
  NOT_PLACEHOLDER_FILTER,
  NOT_PLACEHOLDER_VALUES,
} from '../common/constants/locations.constants';

/** The key prefix and index partition of each kind that can hold stock. */
const KINDS: Record<LocationSummaryType, { prefix: string; indexPk: string }> = {
  warehouse: { prefix: 'WAREHOUSE#', indexPk: LOCATION_INDEX_PK.warehouse },
  container: { prefix: 'CONTAINER#', indexPk: LOCATION_INDEX_PK.container },
};

/**
 * Reads locations of either kind without pulling the warehouses and containers
 * modules into StockModule. Same rows as those repositories:
 *   PK = WAREHOUSE#<id> | CONTAINER#<id>, SK = METADATA
 *   GSI1PK = LOCATION#WAREHOUSE | LOCATION#CONTAINER, GSI1SK = <name lowercased>#<id>
 * Workiz placeholders (`placeholder: true`) are left out of `listAll`, read
 * on their own by `listPlaceholders`, and found by `findLocation` like any row.
 */
@Injectable()
export class LocationsRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async findLocation(type: LocationType, id: string): Promise<LocationSummary | null> {
    const kind = this.kindOf(type);
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `${KINDS[kind].prefix}${id}`, SK: 'METADATA' },
      }),
    );

    if (!result.Item) return null;
    return this.toSummary(kind, result.Item);
  }

  /** Every real location of that kind, whatever its status, in name order — no Workiz placeholders. */
  async listAll(type: LocationType): Promise<LocationSummary[]> {
    return this.queryKind(type, NOT_PLACEHOLDER_FILTER, { ...NOT_PLACEHOLDER_VALUES });
  }

  /**
   * The Workiz placeholders of that kind, in name order — only for the views
   * that must not let units on one become invisible.
   */
  async listPlaceholders(type: LocationType): Promise<LocationSummary[]> {
    return this.queryKind(type, 'placeholder = :true', { ':true': true });
  }

  private async queryKind(
    type: LocationType,
    filter: string,
    filterValues: Record<string, unknown>,
  ): Promise<LocationSummary[]> {
    const kind = this.kindOf(type);
    const locations: LocationSummary[] = [];
    let key: Record<string, unknown> | undefined;

    do {
      const page = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: INVENTORY_TABLE,
          IndexName: GSI1_NAME,
          KeyConditionExpression: 'GSI1PK = :pk',
          FilterExpression: filter,
          ExpressionAttributeValues: { ':pk': KINDS[kind].indexPk, ...filterValues },
          ...(key ? { ExclusiveStartKey: key } : {}),
        }),
      );
      for (const item of page.Items ?? []) locations.push(this.toSummary(kind, item));
      key = page.LastEvaluatedKey;
    } while (key);

    return locations;
  }

  /** The supplier is where received stock comes from; it holds nothing and has no row. */
  private kindOf(type: LocationType): LocationSummaryType {
    if (type === LocationType.WAREHOUSE) return 'warehouse';
    if (type === LocationType.CONTAINER) return 'container';
    throw new BadRequestException(`"${type}" is not a stock location`);
  }

  private toSummary(kind: LocationSummaryType, item: Record<string, unknown>): LocationSummary {
    const technicianName = item.technicianName as string | undefined;
    return {
      type: kind,
      id: item.id as string,
      // The label ContainersRepository shows for a row written before
      // containers had their own name.
      name:
        (item.name as string | undefined) ??
        (kind === 'container'
          ? technicianName
            ? `${technicianName}'s van`
            : 'Container'
          : ''),
      description: item.description as string | undefined,
      technicianId: item.technicianId as string | undefined,
      department: item.department as string | undefined,
      status: item.status as InventoryStatus,
      ...(item.placeholder === true && { placeholder: true }),
    };
  }
}
