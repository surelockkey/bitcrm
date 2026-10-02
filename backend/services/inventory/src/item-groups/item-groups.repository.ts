import { Injectable } from '@nestjs/common';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type ItemGroup, type ItemGroupMember } from '@bitcrm/types';
import { INVENTORY_TABLE, GSI1_NAME } from '../common/constants/dynamo.constants';
import { ITEM_GROUP_GSI1PK, ITEM_GROUP_PK_PREFIX, ITEM_GROUP_SK } from './item-groups.constants';

const finite = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Only text values — the shape `Product.customAttributes` has. */
function textValues(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) out[key] = v;
  }
  return out;
}

/**
 * A stored member as the API serves it — the fields a job line takes, and
 * nothing else: the importer's extras (`cost`, `workizItemId`, `manageStock`…)
 * stay in the table, so a caller without `financials.view` never reads a cost.
 * A member whose Workiz item has no product here (`productId` empty) is left
 * out — it could never become a job line.
 */
function toMember(row: unknown): ItemGroupMember | null {
  if (!row || typeof row !== 'object') return null;
  const m = row as Record<string, unknown>;
  if (typeof m.productId !== 'string' || !m.productId) return null;
  return {
    productId: m.productId,
    name: str(m.name),
    quantity: finite(m.quantity),
    priceClient: finite(m.priceClient),
    // Absent ⇒ taxable, as on a price-book product.
    taxable: m.taxable !== false,
    description: str(m.description),
    customAttributes: textValues(m.customAttributes),
  };
}

/** Σ quantity × priceClient, in cents so 3 × $0.10 is $0.30. */
export function itemGroupTotal(members: Pick<ItemGroupMember, 'quantity' | 'priceClient'>[]): number {
  const cents = members.reduce((sum, m) => sum + m.quantity * m.priceClient * 100, 0);
  return Math.round(cents) / 100;
}

/**
 * Item groups (`ITEM_GROUP#<id>` / `METADATA`, members inline). Read-only
 * here: the Workiz import writes them.
 */
@Injectable()
export class ItemGroupsRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async get(id: string): Promise<ItemGroup | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `${ITEM_GROUP_PK_PREFIX}${id}`, SK: ITEM_GROUP_SK },
      }),
    );
    return result.Item ? this.toEntity(result.Item) : null;
  }

  /** Every group — a Query of the catalog partition to its end, never a Scan. */
  async listAll(): Promise<ItemGroup[]> {
    const rows: Record<string, unknown>[] = [];
    let key: Record<string, unknown> | undefined;
    do {
      const result = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: INVENTORY_TABLE,
          IndexName: GSI1_NAME,
          KeyConditionExpression: 'GSI1PK = :pk',
          ExpressionAttributeValues: { ':pk': ITEM_GROUP_GSI1PK },
          ...(key ? { ExclusiveStartKey: key } : {}),
        }),
      );
      rows.push(...(result.Items ?? []));
      key = result.LastEvaluatedKey;
    } while (key);
    return rows.map((row) => this.toEntity(row));
  }

  private toEntity(row: Record<string, unknown>): ItemGroup {
    const members = (Array.isArray(row.members) ? row.members : [])
      .map(toMember)
      .filter((m): m is ItemGroupMember => m !== null);
    return {
      id: row.id as string,
      name: str(row.name),
      description: str(row.description),
      members,
      total: itemGroupTotal(members),
      ...(typeof row.externalId === 'string' && { externalId: row.externalId }),
      ...(typeof row.createdBy === 'string' && { createdBy: row.createdBy }),
      ...(typeof row.createdAt === 'string' && { createdAt: row.createdAt }),
      ...(typeof row.updatedAt === 'string' && { updatedAt: row.updatedAt }),
    };
  }
}
