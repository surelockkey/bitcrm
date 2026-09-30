import { Injectable, Logger } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type Brand } from '@bitcrm/types';
import { INVENTORY_TABLE, GSI1_NAME, GSI4_NAME } from '../common/constants/dynamo.constants';
import { BRAND_PK_PREFIX, BRAND_SK, BRAND_GSI1PK } from './brands.constants';
import { PRODUCT_CATALOG_INDEX_PK } from '../products/product-catalog-index';
import { PRODUCT_INDEX_MAX_READS } from '../products/products.constants';

/** Key attributes that must never leak into an entity or be re-put verbatim. */
const KEY_ATTRIBUTES = new Set([
  'PK', 'SK', 'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK', 'GSI3PK', 'GSI3SK', 'GSI4PK', 'GSI4SK',
]);

/**
 * Brand catalog rows in the single BitCRM_Inventory table:
 *   PK = BRAND#<id>, SK = METADATA
 *   GSI1PK = CATALOG#BRAND, GSI1SK = <name lowercased>  (list index)
 *
 * Same shape as ItemCategoriesRepository — including keeping the extra
 * attributes the Workiz import writes (`externalId`, `description`) across the
 * full-`Put` update path.
 */
@Injectable()
export class BrandsRepository {
  private readonly logger = new Logger(BrandsRepository.name);

  constructor(private readonly dynamoDb: DynamoDbService) {}

  private item(brand: Brand): Record<string, unknown> {
    return {
      ...brand,
      PK: `${BRAND_PK_PREFIX}${brand.id}`,
      SK: BRAND_SK,
      GSI1PK: BRAND_GSI1PK,
      GSI1SK: brand.name.toLowerCase(),
    };
  }

  /** Insert a new brand; fails if the id already exists. */
  async create(brand: Brand): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: INVENTORY_TABLE,
        Item: this.item(brand),
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    this.logger.log(`Created brand ${brand.id} (${brand.name})`);
  }

  /** Full replace of an existing brand (used by the update path). */
  async put(brand: Brand): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({ TableName: INVENTORY_TABLE, Item: this.item(brand) }),
    );
  }

  async get(id: string): Promise<Brand | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `${BRAND_PK_PREFIX}${id}`, SK: BRAND_SK },
      }),
    );
    return result.Item ? this.toEntity(result.Item) : null;
  }

  /** The whole catalog, in name order — read to the end of the partition, never cut at one 1 MB page. */
  async listAll(): Promise<Brand[]> {
    const rows: Record<string, unknown>[] = [];
    let key: Record<string, unknown> | undefined;
    do {
      const result = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: INVENTORY_TABLE,
          IndexName: GSI1_NAME,
          KeyConditionExpression: 'GSI1PK = :pk',
          ExpressionAttributeValues: { ':pk': BRAND_GSI1PK },
          ...(key ? { ExclusiveStartKey: key } : {}),
        }),
      );
      rows.push(...(result.Items ?? []));
      key = result.LastEvaluatedKey;
    } while (key);
    return rows.map((i) => this.toEntity(i));
  }

  async remove(id: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `${BRAND_PK_PREFIX}${id}`, SK: BRAND_SK },
      }),
    );
    this.logger.log(`Deleted brand ${id}`);
  }

  /**
   * Whether any product still names this brand (`Product.brandId`). There is
   * no brand index, so this reads the Price Book partition (GSI4
   * `PRODUCTS#ALL`, every product) with a filter and stops at the first page
   * holding a match — `Select: 'COUNT'`, no bodies. A walk that runs out of
   * reads before the end answers true: archiving a brand nobody uses is
   * harmless, deleting one items still point at leaves them dangling. Rows
   * not yet filed by `backfill:product-catalog-index` are not seen.
   */
  async isReferencedByProduct(brandId: string): Promise<boolean> {
    let key: Record<string, unknown> | undefined;
    for (let reads = 0; reads < PRODUCT_INDEX_MAX_READS; reads += 1) {
      const result = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: INVENTORY_TABLE,
          IndexName: GSI4_NAME,
          KeyConditionExpression: 'GSI4PK = :pk',
          FilterExpression: 'brandId = :brandId',
          ExpressionAttributeValues: { ':pk': PRODUCT_CATALOG_INDEX_PK, ':brandId': brandId },
          Select: 'COUNT',
          ...(key ? { ExclusiveStartKey: key } : {}),
        }),
      );
      if ((result.Count ?? 0) > 0) return true;
      key = result.LastEvaluatedKey;
      if (!key) return false;
    }
    return true;
  }

  private toEntity(item: Record<string, unknown>): Brand {
    const extras: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      if (!KEY_ATTRIBUTES.has(key)) extras[key] = value;
    }
    return {
      ...extras,
      id: item.id as string,
      name: item.name as string,
      active: Boolean(item.active),
      createdBy: item.createdBy as string,
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    };
  }
}
