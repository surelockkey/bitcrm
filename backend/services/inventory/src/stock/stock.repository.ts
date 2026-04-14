import { BadRequestException, Injectable } from '@nestjs/common';
import {
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type StockItem } from '@bitcrm/types';
import { INVENTORY_TABLE } from '../common/constants/dynamo.constants';

@Injectable()
export class StockRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async getStockLevel(
    entityPK: string,
    productId: string,
  ): Promise<StockItem | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: entityPK, SK: `STOCK#${productId}` },
      }),
    );

    if (!result.Item) return null;
    return this.toStockItem(result.Item);
  }

  async getStockLevels(entityPK: string): Promise<StockItem[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: INVENTORY_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': entityPK,
          ':prefix': 'STOCK#',
        },
      }),
    );

    return (result.Items || []).map((item) => this.toStockItem(item));
  }

  async incrementStock(
    entityPK: string,
    productId: string,
    productName: string,
    quantity: number,
  ): Promise<void> {
    await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: entityPK, SK: `STOCK#${productId}` },
        UpdateExpression:
          'ADD #quantity :qty SET productId = :pid, productName = :pname, updatedAt = :now',
        ExpressionAttributeNames: { '#quantity': 'quantity' },
        ExpressionAttributeValues: {
          ':qty': quantity,
          ':pid': productId,
          ':pname': productName,
          ':now': new Date().toISOString(),
        },
      }),
    );
  }

  async decrementStock(
    entityPK: string,
    productId: string,
    quantity: number,
  ): Promise<void> {
    try {
      await this.dynamoDb.client.send(
        new UpdateCommand({
          TableName: INVENTORY_TABLE,
          Key: { PK: entityPK, SK: `STOCK#${productId}` },
          UpdateExpression:
            'SET #quantity = #quantity - :qty, updatedAt = :now',
          ConditionExpression: '#quantity >= :qty',
          ExpressionAttributeNames: { '#quantity': 'quantity' },
          ExpressionAttributeValues: {
            ':qty': quantity,
            ':now': new Date().toISOString(),
          },
        }),
      );
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.name === 'ConditionalCheckFailedException'
      ) {
        throw new BadRequestException(
          `Insufficient stock for product ${productId}`,
        );
      }
      throw error;
    }
  }

  private toStockItem(item: Record<string, any>): StockItem {
    return {
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      updatedAt: item.updatedAt,
    };
  }
}
