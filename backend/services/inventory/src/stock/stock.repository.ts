import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import {
  BatchGetCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService, RedisService } from '@bitcrm/shared';
import { type StockItem } from '@bitcrm/types';
import { INVENTORY_TABLE } from '../common/constants/dynamo.constants';
import { productCacheKey } from '../products/products-cache.service';

/**
 * Stock rows in the single BitCRM_Inventory table:
 *   PK = WAREHOUSE#<id> | CONTAINER#<id>, SK = STOCK#<productId>
 *     { productId, productName, quantity, updatedAt }
 * Every quantity change here also moves `onHand` on PRODUCT#<productId> /
 * METADATA — the total across locations that the product list and card
 * show — and drops that product's Redis cache entry.
 */
@Injectable()
export class StockRepository {
  private readonly logger = new Logger(StockRepository.name);

  constructor(
    private readonly dynamoDb: DynamoDbService,
    @Optional() private readonly redis?: RedisService,
  ) {}

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

  /**
   * How many of one product each of the given locations holds, keyed by the
   * location PK; a location with no stock row is simply absent. BatchGet takes
   * 100 keys a call, and keys it leaves unprocessed under load are asked again.
   */
  async getProductQuantities(
    productId: string,
    entityPKs: string[],
  ): Promise<Map<string, number>> {
    const quantities = new Map<string, number>();
    for (let i = 0; i < entityPKs.length; i += 100) {
      let keys = entityPKs
        .slice(i, i + 100)
        .map((pk) => ({ PK: pk, SK: `STOCK#${productId}` }));
      while (keys.length) {
        const res = await this.dynamoDb.client.send(
          new BatchGetCommand({ RequestItems: { [INVENTORY_TABLE]: { Keys: keys } } }),
        );
        for (const item of res.Responses?.[INVENTORY_TABLE] ?? []) {
          quantities.set(item.PK as string, Number(item.quantity) || 0);
        }
        keys = (res.UnprocessedKeys?.[INVENTORY_TABLE]?.Keys ?? []) as typeof keys;
      }
    }
    return quantities;
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
    await this.moveOnHand(productId, quantity);
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
    await this.moveOnHand(productId, -quantity);
  }

  /**
   * Keep the product row's `onHand` in step with a stock row that just moved.
   * Stock rows may name ids the catalog never persisted (tests and imports
   * do), so a missing product row is a warning, not a failure; anything else
   * propagates. The cached product would otherwise serve the old total for up
   * to five minutes, so its key is dropped — best effort.
   */
  private async moveOnHand(productId: string, delta: number): Promise<void> {
    try {
      await this.dynamoDb.client.send(
        new UpdateCommand({
          TableName: INVENTORY_TABLE,
          Key: { PK: `PRODUCT#${productId}`, SK: 'METADATA' },
          UpdateExpression: 'ADD onHand :delta',
          ExpressionAttributeValues: { ':delta': delta },
          ConditionExpression: 'attribute_exists(PK)',
        }),
      );
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.name === 'ConditionalCheckFailedException'
      ) {
        this.logger.warn(
          `Stock moved for product ${productId}, which has no catalog row; onHand not updated`,
        );
      } else {
        throw error;
      }
    }

    if (!this.redis) return;
    try {
      await this.redis.client.del(productCacheKey(productId));
    } catch (err) {
      this.logger.warn(
        `Product cache eviction failed for ${productId}: ${(err as Error).message}`,
      );
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
