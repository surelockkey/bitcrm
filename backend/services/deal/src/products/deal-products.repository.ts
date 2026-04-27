import { Injectable } from '@nestjs/common';
import { PutCommand, DeleteCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type DealProduct } from '@bitcrm/types';
import { DEALS_TABLE } from '../common/constants/dynamo.constants';

@Injectable()
export class DealProductsRepository {
  private tableName = DEALS_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  async addProduct(dealId: string, product: DealProduct): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `DEAL#${dealId}`,
          SK: `PRODUCT#${product.productId}`,
          ...product,
        },
      }),
    );
  }

  async removeProduct(dealId: string, productId: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          PK: `DEAL#${dealId}`,
          SK: `PRODUCT#${productId}`,
        },
      }),
    );
  }

  async findByDeal(dealId: string): Promise<DealProduct[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `DEAL#${dealId}`,
          ':sk': 'PRODUCT#',
        },
      }),
    );

    return (result.Items || []).map((i) => this.toProduct(i));
  }

  async findProduct(dealId: string, productId: string): Promise<DealProduct | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: `DEAL#${dealId}`,
          SK: `PRODUCT#${productId}`,
        },
      }),
    );

    if (!result.Item) return null;
    return this.toProduct(result.Item);
  }

  private toProduct(item: Record<string, unknown>): DealProduct {
    return {
      productId: item.productId as string,
      name: item.name as string,
      sku: item.sku as string,
      quantity: item.quantity as number,
      costCompany: item.costCompany as number,
      costForTech: item.costForTech as number,
      priceClient: item.priceClient as number,
      addedBy: item.addedBy as string,
      addedAt: item.addedAt as string,
    };
  }
}
