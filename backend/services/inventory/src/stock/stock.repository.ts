import {
  ConflictException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService, RedisService } from '@bitcrm/shared';
import { type StockItem } from '@bitcrm/types';
import { INVENTORY_TABLE } from '../common/constants/dynamo.constants';
import { productCacheKey } from '../products/products-cache.service';
import { batchGetAll } from '../common/utils/batch-get';
import {
  guessStockRowVariant,
  stockRowVariant,
  type StockLeg,
  type StockRowVariant,
} from './stock-row-variant';

/** One `Update` of a TransactWrite — the same shape an UpdateCommand takes. */
type UpdateSpec = NonNullable<
  NonNullable<TransactWriteCommandInput['TransactItems']>[number]['Update']
>;

/** One item of a stock write's TransactWrite, and which leg it belongs to. */
interface WritePart {
  kind: 'stock' | 'totals' | 'onHand';
  leg?: number;
  update: UpdateSpec;
}

/**
 * Attempts of one stock write: guesses, re-reads, rows the backfill has not
 * reached and conflicts each cost one. A handful is plenty; past it the row
 * is changing faster than it can be written, and the caller is told so.
 */
const STOCK_WRITE_ATTEMPTS = 8;
const STOCK_CONFLICT_BACKOFF_MS = 10;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
 * Every quantity change here also moves, in the SAME TransactWrite:
 *   - `totalUnits` (Σ quantity) and `uniqueItems` (rows with quantity > 0) on
 *     the location's own row, PK = WAREHOUSE#<id> | CONTAINER#<id>, SK =
 *     METADATA — what the warehouse and container lists show per row;
 *   - `onHand` on PRODUCT#<productId> / METADATA — the total across
 *     locations that the product list and card show (a move leaves it alone).
 * A failure can never leave the stock row moved and a total stale. A row that
 * has no total yet (written before the attribute existed, until
 * `backfill:location-totals` / `backfill:product-onhand` has run) is left
 * alone rather than given a wrong number. The product's Redis cache entry is
 * dropped afterwards.
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

  /**
   * Every stock row of one location, read to the end of the partition: a
   * warehouse with thousands of products is more than the 1 MB one Query page
   * holds, and a single read silently dropped the rest.
   */
  async getStockLevels(entityPK: string): Promise<StockItem[]> {
    const items: StockItem[] = [];
    let key: Record<string, unknown> | undefined;
    do {
      const result = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: INVENTORY_TABLE,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: {
            ':pk': entityPK,
            ':prefix': 'STOCK#',
          },
          ...(key ? { ExclusiveStartKey: key } : {}),
        }),
      );
      for (const item of result.Items || []) items.push(this.toStockItem(item));
      key = result.LastEvaluatedKey;
    } while (key);
    return items;
  }

  /**
   * How many of one product each of the given locations holds, keyed by the
   * location PK; a location with no stock row is simply absent.
   */
  async getProductQuantities(
    productId: string,
    entityPKs: string[],
  ): Promise<Map<string, number>> {
    const quantities = new Map<string, number>();
    const rows = await this.batchGetStockRows(
      entityPKs.map((pk) => ({ PK: pk, SK: `STOCK#${productId}` })),
    );
    for (const item of rows) {
      quantities.set(item.PK as string, Number(item.quantity) || 0);
    }
    return quantities;
  }

  /**
   * How many of each product each location holds — every (location, product)
   * pair is one BatchGet key, so comparing a van template of a few dozen lines
   * against a van and a warehouse is one or two calls, never a Query over a
   * warehouse's thousands of stock rows. Keyed by location PK, then product
   * id; a pair with no stock row is simply absent.
   */
  async getQuantities(
    entityPKs: string[],
    productIds: string[],
  ): Promise<Map<string, Map<string, number>>> {
    const quantities = new Map<string, Map<string, number>>();
    const keys = entityPKs.flatMap((pk) =>
      productIds.map((productId) => ({ PK: pk, SK: `STOCK#${productId}` })),
    );
    for (const item of await this.batchGetStockRows(keys)) {
      const pk = item.PK as string;
      const productId =
        (item.productId as string | undefined) ?? String(item.SK).slice('STOCK#'.length);
      if (!quantities.has(pk)) quantities.set(pk, new Map());
      quantities.get(pk)!.set(productId, Number(item.quantity) || 0);
    }
    return quantities;
  }

  /** Stock rows by key — the shared BatchGet loop (100 keys a call, bounded retries, 503). */
  private batchGetStockRows(
    allKeys: Array<{ PK: string; SK: string }>,
  ): Promise<Record<string, unknown>[]> {
    return batchGetAll(this.dynamoDb.client, allKeys);
  }

  async incrementStock(
    entityPK: string,
    productId: string,
    productName: string,
    quantity: number,
  ): Promise<void> {
    await this.writeStock(
      [{ pk: entityPK, productId, productName, quantity, direction: 'add' }],
      { productId, delta: quantity },
    );
  }

  async decrementStock(
    entityPK: string,
    productId: string,
    quantity: number,
  ): Promise<void> {
    await this.writeStock(
      [{ pk: entityPK, productId, quantity, direction: 'take' }],
      { productId, delta: -quantity },
    );
  }

  /**
   * One product from one location to another, in one TransactWrite: the
   * source row is taken from under its condition and the destination row
   * added to, with both locations' totals, so a failure between the two can
   * never leave the units "in transit". The product's `onHand` is untouched —
   * the two deltas cancel. Insufficient stock at the source is the same 400 a
   * deduct answers.
   */
  async moveStock(
    fromPK: string,
    toPK: string,
    productId: string,
    productName: string,
    quantity: number,
  ): Promise<void> {
    await this.writeStock([
      { pk: fromPK, productId, quantity, direction: 'take' },
      { pk: toPK, productId, productName, quantity, direction: 'add' },
    ]);
  }

  /**
   * The stock rows, their locations' totals and (for a receive or a deduct)
   * the product's `onHand`, as ONE TransactWrite — all of it or none of it.
   *
   * Each stock row carries the condition of its `StockRowVariant`: the first
   * attempt guesses the common case, and a refused row is read (consistently)
   * and written again with the variant for what it holds — so `uniqueItems`
   * moves by exactly the delta the applied state calls for, whatever runs in
   * between. A row that cannot give the units is insufficient stock (400).
   *
   * A location or product row that refused its own condition — no such row
   * (tests and imports name ids BitCRM never wrote), or no totals / `onHand`
   * yet because the backfill has not reached it — is left out of the next
   * attempt with a warning; the stock still moves. A cancellation for a
   * transaction conflict (two writes on the same location row at once) is
   * retried: a cancelled transaction applied nothing. Anything else
   * propagates untouched, and a row that keeps changing gives up with a 409.
   *
   * The cached product would otherwise serve the old `onHand` for up to five
   * minutes, so its key is dropped afterwards — best effort.
   */
  private async writeStock(
    legs: StockLeg[],
    onHand?: { productId: string; delta: number },
  ): Promise<void> {
    const stored = new Map<number, number | null>();
    const withTotals = legs.map(() => true);
    let withOnHand = onHand !== undefined;

    for (let attempt = 1; ; attempt++) {
      const variants = legs.map((leg, i) =>
        stored.has(i) ? stockRowVariant(leg, stored.get(i)!) : guessStockRowVariant(leg),
      );
      const parts: WritePart[] = [
        ...legs.map((leg, i): WritePart => ({ kind: 'stock', leg: i, update: this.stockUpdate(leg, variants[i]) })),
        ...legs.flatMap((leg, i): WritePart[] =>
          withTotals[i]
            ? [{ kind: 'totals', leg: i, update: this.totalsDelta(leg, variants[i].uniqueDelta) }]
            : [],
        ),
        ...(onHand && withOnHand
          ? [{ kind: 'onHand', update: this.onHandDelta(onHand.productId, onHand.delta) } as WritePart]
          : []),
      ];

      try {
        await this.dynamoDb.client.send(
          new TransactWriteCommand({ TransactItems: parts.map((part) => ({ Update: part.update })) }),
        );
        break;
      } catch (error: unknown) {
        const reasons = cancellationReasons(error);
        if (!reasons) throw error;
        const refused = parts.filter((_, i) => reasons[i] === 'ConditionalCheckFailed');
        const conflicted = reasons.includes('TransactionConflict');
        if (refused.length === 0 && !conflicted) throw error;

        for (const part of refused) {
          if (part.kind === 'totals') {
            withTotals[part.leg!] = false;
            this.logger.warn(
              `Stock moved at ${legs[part.leg!].pk}, which has no row or no totals yet ` +
                '(run backfill:location-totals); totals not updated',
            );
          } else if (part.kind === 'onHand') {
            withOnHand = false;
            this.logger.warn(
              `Stock moved for product ${onHand!.productId}, which has no catalog row or no onHand yet ` +
                '(run backfill:product-onhand); onHand not updated',
            );
          }
        }
        const reread = refused.filter((part) => part.kind === 'stock');
        // What the refused rows hold now; a take that cannot be given throws here.
        const found = await Promise.all(reread.map((part) => this.storedQuantity(legs[part.leg!])));
        reread.forEach((part, i) => {
          stockRowVariant(legs[part.leg!], found[i]);
          stored.set(part.leg!, found[i]);
        });
        if (attempt >= STOCK_WRITE_ATTEMPTS) {
          throw new ConflictException(
            `Stock of product ${legs[0].productId} kept changing during the write; try again`,
          );
        }
        if (refused.length === 0) await pause(STOCK_CONFLICT_BACKOFF_MS * 2 ** (attempt - 1));
      }
    }

    if (!onHand || !this.redis) return;
    try {
      await this.redis.client.del(productCacheKey(onHand.productId));
    } catch (err) {
      this.logger.warn(
        `Product cache eviction failed for ${onHand.productId}: ${(err as Error).message}`,
      );
    }
  }

  /** The quantity one stock row holds right now; null when there is no row (or no quantity). */
  private async storedQuantity(leg: StockLeg): Promise<number | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: leg.pk, SK: `STOCK#${leg.productId}` },
        ProjectionExpression: '#quantity',
        ExpressionAttributeNames: { '#quantity': 'quantity' },
        ConsistentRead: true,
      }),
    );
    const quantity = result.Item?.quantity;
    return quantity === undefined || quantity === null ? null : Number(quantity);
  }

  /** The stock row's share: `ADD` for units in, `SET … -` for units out, under the variant's condition. */
  private stockUpdate(leg: StockLeg, variant: StockRowVariant): UpdateSpec {
    const now = new Date().toISOString();
    if (leg.direction === 'take') {
      return {
        TableName: INVENTORY_TABLE,
        Key: { PK: leg.pk, SK: `STOCK#${leg.productId}` },
        UpdateExpression: 'SET #quantity = #quantity - :qty, updatedAt = :now',
        ConditionExpression: variant.condition,
        ExpressionAttributeNames: { '#quantity': 'quantity' },
        ExpressionAttributeValues: { ':qty': leg.quantity, ':now': now, ...variant.values },
      };
    }
    return {
      TableName: INVENTORY_TABLE,
      Key: { PK: leg.pk, SK: `STOCK#${leg.productId}` },
      UpdateExpression:
        'ADD #quantity :qty SET productId = :pid, productName = :pname, updatedAt = :now',
      ConditionExpression: variant.condition,
      ExpressionAttributeNames: { '#quantity': 'quantity' },
      ExpressionAttributeValues: {
        ':qty': leg.quantity,
        ':pid': leg.productId,
        ':pname': leg.productName ?? leg.productId,
        ':now': now,
        ...variant.values,
      },
    };
  }

  /**
   * The location row's share: `totalUnits` by the units moved, `uniqueItems`
   * by the variant's delta (left out when it is 0). Like `onHand`, a row with
   * no `totalUnits` yet refuses — `ADD` would create it as the delta.
   */
  private totalsDelta(leg: StockLeg, uniqueDelta: number): UpdateSpec {
    const units = leg.direction === 'add' ? leg.quantity : -leg.quantity;
    return {
      TableName: INVENTORY_TABLE,
      Key: { PK: leg.pk, SK: 'METADATA' },
      UpdateExpression: uniqueDelta
        ? 'ADD totalUnits :units, uniqueItems :items'
        : 'ADD totalUnits :units',
      ExpressionAttributeValues: { ':units': units, ...(uniqueDelta && { ':items': uniqueDelta }) },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(totalUnits)',
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

  private toStockItem(item: Record<string, any>): StockItem {
    return {
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      updatedAt: item.updatedAt,
    };
  }
}
