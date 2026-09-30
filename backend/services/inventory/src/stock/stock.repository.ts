import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  BatchGetCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService, RedisService } from '@bitcrm/shared';
import { type StockItem } from '@bitcrm/types';
import { INVENTORY_TABLE } from '../common/constants/dynamo.constants';
import { productCacheKey } from '../products/products-cache.service';

/** One `Update` of a TransactWrite — the same shape an UpdateCommand takes. */
type UpdateSpec = NonNullable<
  NonNullable<TransactWriteCommandInput['TransactItems']>[number]['Update']
>;

/**
 * BatchGet hands keys back unprocessed when the table is throttled, and the
 * SDK does not retry them (the call succeeded). A few attempts with a doubling
 * pause, then the request fails instead of hammering the table until the
 * load balancer times it out.
 */
const BATCH_GET_ATTEMPTS = 5;
const BATCH_GET_BACKOFF_MS = 50;

/** The per-item reasons DynamoDB attaches to a cancelled TransactWrite, or null for any other error. */
function cancellationReasons(error: unknown): string[] | null {
  if (!(error instanceof Error) || error.name !== 'TransactionCanceledException') return null;
  const reasons = (error as Error & { CancellationReasons?: { Code?: string }[] }).CancellationReasons;
  return (reasons ?? []).map((r) => r.Code ?? 'None');
}

/**
 * Stock rows in the single BitCRM_Inventory table:
 *   PK = WAREHOUSE#<id> | CONTAINER#<id>, SK = STOCK#<productId>
 *     { productId, productName, quantity, updatedAt }
 * Every quantity change here also moves `onHand` on PRODUCT#<productId> /
 * METADATA — the total across locations that the product list and card
 * show — in the SAME TransactWrite, so a failure can never leave the stock
 * row moved and the total stale. A product row that has no `onHand` yet
 * (written before the attribute existed, until `backfill:product-onhand`
 * has run) is left alone rather than given a wrong number. That product's
 * Redis cache entry is dropped afterwards.
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
   * 100 keys a call; keys it leaves unprocessed under load are asked again
   * with a backoff, a bounded number of times.
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
      for (let attempt = 0; keys.length; attempt++) {
        if (attempt >= BATCH_GET_ATTEMPTS) {
          throw new ServiceUnavailableException('Stock read throttled; try again');
        }
        if (attempt > 0) await this.pause(BATCH_GET_BACKOFF_MS * 2 ** (attempt - 1));
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
    await this.writeWithOnHand(
      this.stockAdd(entityPK, productId, productName, quantity),
      productId,
      quantity,
    );
  }

  async decrementStock(
    entityPK: string,
    productId: string,
    quantity: number,
  ): Promise<void> {
    await this.writeWithOnHand(
      this.stockSubtract(entityPK, productId, quantity),
      productId,
      -quantity,
    );
  }

  /**
   * One product from one location to another, in one TransactWrite: the
   * source row is subtracted under its condition and the destination row
   * added, so a failure between the two can never leave the units "in
   * transit". The product's `onHand` is untouched — the two deltas cancel.
   * Insufficient stock at the source is the same 400 a deduct answers.
   */
  async moveStock(
    fromPK: string,
    toPK: string,
    productId: string,
    productName: string,
    quantity: number,
  ): Promise<void> {
    try {
      await this.dynamoDb.client.send(
        new TransactWriteCommand({
          TransactItems: [
            { Update: this.stockSubtract(fromPK, productId, quantity) },
            { Update: this.stockAdd(toPK, productId, productName, quantity) },
          ],
        }),
      );
    } catch (error: unknown) {
      if (cancellationReasons(error)?.[0] === 'ConditionalCheckFailed') {
        throw new BadRequestException(`Insufficient stock for product ${productId}`);
      }
      throw error;
    }
  }

  private stockAdd(
    entityPK: string,
    productId: string,
    productName: string,
    quantity: number,
  ): UpdateSpec {
    return {
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
    };
  }

  private stockSubtract(entityPK: string, productId: string, quantity: number): UpdateSpec {
    return {
      TableName: INVENTORY_TABLE,
      Key: { PK: entityPK, SK: `STOCK#${productId}` },
      UpdateExpression: 'SET #quantity = #quantity - :qty, updatedAt = :now',
      ConditionExpression: '#quantity >= :qty',
      ExpressionAttributeNames: { '#quantity': 'quantity' },
      ExpressionAttributeValues: {
        ':qty': quantity,
        ':now': new Date().toISOString(),
      },
    };
  }

  /**
   * The product row's share of a stock write. `ADD` on a missing number
   * creates it as the delta — 2 units out of 10 would read as -2 — so a row
   * with no `onHand` yet refuses and keeps none until the backfill sums it.
   */
  private onHandDelta(productId: string, delta: number): UpdateSpec {
    return {
      TableName: INVENTORY_TABLE,
      Key: { PK: `PRODUCT#${productId}`, SK: 'METADATA' },
      UpdateExpression: 'ADD onHand :delta',
      ExpressionAttributeValues: { ':delta': delta },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(onHand)',
    };
  }

  /**
   * The stock row and the product's `onHand` together. A refused stock row is
   * insufficient stock. When only the product side refused — no catalog row
   * (tests and imports name such ids) or no `onHand` yet — the stock row is
   * written alone and a warning logged. Anything else propagates untouched.
   * The cached product would otherwise serve the old total for up to five
   * minutes, so its key is dropped — best effort.
   */
  private async writeWithOnHand(stock: UpdateSpec, productId: string, delta: number): Promise<void> {
    try {
      await this.dynamoDb.client.send(
        new TransactWriteCommand({
          TransactItems: [{ Update: stock }, { Update: this.onHandDelta(productId, delta) }],
        }),
      );
    } catch (error: unknown) {
      const [stockReason, productReason] = cancellationReasons(error) ?? [];
      if (stockReason === 'ConditionalCheckFailed') {
        throw new BadRequestException(`Insufficient stock for product ${productId}`);
      }
      if (stockReason === 'None' && productReason === 'ConditionalCheckFailed') {
        this.logger.warn(
          `Stock moved for product ${productId}, which has no catalog row or no onHand yet ` +
            '(run backfill:product-onhand); onHand not updated',
        );
        await this.writeStockAlone(stock, productId);
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

  private async writeStockAlone(stock: UpdateSpec, productId: string): Promise<void> {
    try {
      await this.dynamoDb.client.send(new UpdateCommand(stock));
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        throw new BadRequestException(`Insufficient stock for product ${productId}`);
      }
      throw error;
    }
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
