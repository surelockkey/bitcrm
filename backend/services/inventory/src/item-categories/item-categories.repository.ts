import { Injectable, Logger } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type ProductCategory } from '@bitcrm/types';
import { INVENTORY_TABLE, GSI1_NAME } from '../common/constants/dynamo.constants';
import {
  ITEM_CATEGORY_PK_PREFIX,
  ITEM_CATEGORY_SK,
  ITEM_CATEGORY_GSI1PK,
} from './item-categories.constants';

/**
 * Item-category catalog rows in the single BitCRM_Inventory table:
 *   PK = ITEM_CATEGORY#<id>, SK = METADATA
 *   GSI1PK = CATALOG#ITEM_CATEGORY, GSI1SK = <name lowercased>  (list index)
 *
 * Reuses the existing GSI1 (CategoryIndex) exactly as the deal-service catalogs
 * reuse their GSI1 — no new index, no schema migration.
 */
@Injectable()
export class ItemCategoriesRepository {
  private readonly logger = new Logger(ItemCategoriesRepository.name);

  constructor(private readonly dynamoDb: DynamoDbService) {}

  private item(category: ProductCategory): Record<string, unknown> {
    return {
      PK: `${ITEM_CATEGORY_PK_PREFIX}${category.id}`,
      SK: ITEM_CATEGORY_SK,
      GSI1PK: ITEM_CATEGORY_GSI1PK,
      GSI1SK: category.name.toLowerCase(),
      ...category,
    };
  }

  /** Insert a new category; fails if the id already exists. */
  async create(category: ProductCategory): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: INVENTORY_TABLE,
        Item: this.item(category),
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    this.logger.log(`Created item category ${category.id} (${category.name})`);
  }

  /** Full replace of an existing category (used by the update path). */
  async put(category: ProductCategory): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({ TableName: INVENTORY_TABLE, Item: this.item(category) }),
    );
  }

  async get(id: string): Promise<ProductCategory | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `${ITEM_CATEGORY_PK_PREFIX}${id}`, SK: ITEM_CATEGORY_SK },
      }),
    );
    return result.Item ? this.toEntity(result.Item) : null;
  }

  async listAll(): Promise<ProductCategory[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: INVENTORY_TABLE,
        IndexName: GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': ITEM_CATEGORY_GSI1PK },
      }),
    );
    return (result.Items || []).map((i) => this.toEntity(i));
  }

  /**
   * Whether any product still uses this category NAME (products store the
   * category as a name string). A Query on the CategoryIndex key condition is
   * exact — unlike a Scan+Limit, it can't miss references.
   */
  async isReferencedByProduct(name: string): Promise<boolean> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: INVENTORY_TABLE,
        IndexName: GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `CATEGORY#${name}` },
        Limit: 1,
      }),
    );
    return (result.Items?.length ?? 0) > 0;
  }

  async remove(id: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `${ITEM_CATEGORY_PK_PREFIX}${id}`, SK: ITEM_CATEGORY_SK },
      }),
    );
    this.logger.log(`Deleted item category ${id}`);
  }

  private toEntity(item: Record<string, unknown>): ProductCategory {
    return {
      id: item.id as string,
      name: item.name as string,
      active: Boolean(item.active),
      createdBy: item.createdBy as string,
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    };
  }
}
