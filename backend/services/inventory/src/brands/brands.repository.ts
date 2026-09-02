import { Injectable, Logger } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type Brand } from '@bitcrm/types';
import { INVENTORY_TABLE, GSI1_NAME } from '../common/constants/dynamo.constants';
import { BRAND_PK_PREFIX, BRAND_SK, BRAND_GSI1PK } from './brands.constants';

/**
 * Brand catalog rows in the single BitCRM_Inventory table:
 *   PK = BRAND#<id>, SK = METADATA
 *   GSI1PK = CATALOG#BRAND, GSI1SK = <name lowercased>  (list index)
 *
 * Same shape as ItemCategoriesRepository.
 */
@Injectable()
export class BrandsRepository {
  private readonly logger = new Logger(BrandsRepository.name);

  constructor(private readonly dynamoDb: DynamoDbService) {}

  private item(brand: Brand): Record<string, unknown> {
    return {
      PK: `${BRAND_PK_PREFIX}${brand.id}`,
      SK: BRAND_SK,
      GSI1PK: BRAND_GSI1PK,
      GSI1SK: brand.name.toLowerCase(),
      ...brand,
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

  async listAll(): Promise<Brand[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: INVENTORY_TABLE,
        IndexName: GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': BRAND_GSI1PK },
      }),
    );
    return (result.Items || []).map((i) => this.toEntity(i));
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

  private toEntity(item: Record<string, unknown>): Brand {
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
