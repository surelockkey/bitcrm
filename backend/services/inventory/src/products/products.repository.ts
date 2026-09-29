import { ConflictException, Injectable } from '@nestjs/common';
import {
  GetCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  TransactWriteItemsCommand,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { DynamoDbService, scanPage, countRows, type CountRowsResult } from '@bitcrm/shared';
import { type Product, ProductType } from '@bitcrm/types';
import {
  INVENTORY_TABLE,
  GSI1_NAME,
  GSI2_NAME,
} from '../common/constants/dynamo.constants';

export interface PaginatedResult {
  items: Product[];
  nextCursor?: string;
}

/**
 * The filters a list and its count share. Whichever of category / type picks
 * the index, every one of these is applied on top as a FilterExpression.
 */
export interface ProductListFilters {
  /** Only when category took the index; otherwise type IS the index. */
  type?: string;
  status?: string;
  /** Matched against `name` and `sku`. */
  search?: string;
  brandId?: string;
  /**
   * `true` selects stock-managed products (product-type rows whose flag is
   * absent or true — services are never stock-managed); `false` selects the
   * rows that say `manageStock: false` explicitly.
   */
  manageStock?: boolean;
}

/** Key attributes that must never leak onto an entity. */
const KEY_ATTRIBUTES = new Set([
  'PK', 'SK', 'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK', 'GSI3PK', 'GSI3SK', 'GSI4PK', 'GSI4SK',
]);

const KNOWN_TYPES = new Set<string>(Object.values(ProductType));

/** The product-number counter row. */
const COUNTER_KEY = { PK: 'COUNTER#PRODUCT', SK: 'METADATA' };

/**
 * Product rows in the single BitCRM_Inventory table:
 *   PK = PRODUCT#<id>, SK = METADATA
 *   GSI1PK = CATEGORY#<category>, GSI1SK = PRODUCT#<id>   (CategoryIndex)
 *   GSI2PK = TYPE#<type>,         GSI2SK = PRODUCT#<id>   (TypeIndex)
 *   PK = SKU#<sku>, SK = PRODUCT                          SKU claim → { productId }
 *   PK = COUNTER#PRODUCT, SK = METADATA                   { seq } — the last
 *     product `number` handed out; `nextNumber` ADDs one atomically and
 *     `raiseCounterTo` moves it past imported (Workiz) numbers.
 * `onHand` on the product row is kept by StockRepository, not here.
 */
@Injectable()
export class ProductsRepository {
  private readonly rawClient: DynamoDBClient;

  constructor(private readonly dynamoDb: DynamoDbService) {
    // We need the raw client for TransactWriteItems (not available in DocumentClient)
    this.rawClient = (this.dynamoDb.client as any).config?.client || this.dynamoDb.client;
  }

  /** The next product number: one atomic ADD on the counter row. */
  async nextNumber(): Promise<number> {
    const result = await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: INVENTORY_TABLE,
        Key: COUNTER_KEY,
        UpdateExpression: 'ADD #seq :one',
        ExpressionAttributeNames: { '#seq': 'seq' },
        ExpressionAttributeValues: { ':one': 1 },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return Number(result.Attributes?.seq);
  }

  /**
   * Move the counter up to `n` when it is lower or absent, so numbers handed
   * out after an import never collide with the imported ones. A counter that
   * is already past `n` is left alone.
   */
  async raiseCounterTo(n: number): Promise<void> {
    try {
      await this.dynamoDb.client.send(
        new UpdateCommand({
          TableName: INVENTORY_TABLE,
          Key: COUNTER_KEY,
          UpdateExpression: 'SET #seq = :n',
          ConditionExpression: 'attribute_not_exists(#seq) OR #seq < :n',
          ExpressionAttributeNames: { '#seq': 'seq' },
          ExpressionAttributeValues: { ':n': n },
        }),
      );
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.name === 'ConditionalCheckFailedException'
      ) {
        return;
      }
      throw error;
    }
  }

  async create(product: Product): Promise<void> {
    try {
      await this.dynamoDb.client.send(
        new (await import('@aws-sdk/lib-dynamodb')).TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: INVENTORY_TABLE,
                Item: {
                  PK: `PRODUCT#${product.id}`,
                  SK: 'METADATA',
                  GSI1PK: `CATEGORY#${product.category}`,
                  GSI1SK: `PRODUCT#${product.id}`,
                  GSI2PK: `TYPE#${product.type}`,
                  GSI2SK: `PRODUCT#${product.id}`,
                  ...product,
                },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
            {
              Put: {
                TableName: INVENTORY_TABLE,
                Item: {
                  PK: `SKU#${product.sku}`,
                  SK: 'PRODUCT',
                  productId: product.id,
                },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
          ],
        }),
      );
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.name === 'TransactionCanceledException'
      ) {
        throw new ConflictException(
          `Product with SKU "${product.sku}" already exists`,
        );
      }
      throw error;
    }
  }

  async findById(id: string): Promise<Product | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `PRODUCT#${id}`, SK: 'METADATA' },
      }),
    );

    if (!result.Item) return null;
    return this.toProduct(result.Item);
  }

  async findBySku(sku: string): Promise<Product | null> {
    const skuResult = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: INVENTORY_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `SKU#${sku}` },
        Limit: 1,
      }),
    );

    const items = skuResult.Items || [];
    if (items.length === 0) return null;

    const productId = items[0].productId as string;
    return this.findById(productId);
  }

  async findByBarcode(barcode: string): Promise<Product | null> {
    // No barcode index — a filtered scan is fine for a low-frequency lookup.
    const result = await this.dynamoDb.client.send(
      new ScanCommand({
        TableName: INVENTORY_TABLE,
        FilterExpression: 'begins_with(PK, :pk) AND SK = :sk AND barcode = :b',
        ExpressionAttributeValues: {
          ':pk': 'PRODUCT#',
          ':sk': 'METADATA',
          ':b': barcode,
        },
        Limit: 1,
      }),
    );
    const item = (result.Items || [])[0];
    return item ? this.toProduct(item) : null;
  }

  /**
   * The FilterExpression pieces the list filters translate to, shared by every
   * list and count path so they can never answer about different populations.
   * Empty when nothing is set, so an unfiltered index Query stays bare.
   */
  private filterParts(filters?: ProductListFilters) {
    const parts: string[] = [];
    const values: Record<string, unknown> = {};
    const names: Record<string, string> = {};

    if (filters?.type) {
      parts.push('#type = :type');
      names['#type'] = 'type';
      values[':type'] = filters.type;
    }
    if (filters?.status) {
      parts.push('#status = :status');
      names['#status'] = 'status';
      values[':status'] = filters.status;
    }
    if (filters?.search) {
      parts.push('(contains(#name, :search) OR contains(sku, :search))');
      names['#name'] = 'name';
      values[':search'] = filters.search;
    }
    if (filters?.brandId) {
      parts.push('brandId = :brandId');
      values[':brandId'] = filters.brandId;
    }
    // Workiz's inv_product: a stock-managed product. Rows BitCRM wrote carry
    // no flag and are managed; a service is never managed whatever it says.
    if (filters?.manageStock === true) {
      parts.push(
        '#type = :productType AND (attribute_not_exists(manageStock) OR manageStock = :true)',
      );
      names['#type'] = 'type';
      values[':productType'] = ProductType.PRODUCT;
      values[':true'] = true;
    } else if (filters?.manageStock === false) {
      parts.push('manageStock = :false');
      values[':false'] = false;
    }

    return { parts, values, names };
  }

  /**
   * The Query on one index partition, with the other filters on top. Without
   * a filter it is a single read of exactly one page; with one, `Limit` counts
   * rows read rather than kept, so the page is filled across reads and the
   * cursor carries the index keys along with the table keys.
   */
  private async queryIndex(
    indexName: string,
    keyAttr: 'GSI1PK' | 'GSI2PK',
    pk: string,
    limit: number,
    cursor: string | undefined,
    filters: ProductListFilters | undefined,
  ): Promise<PaginatedResult> {
    const f = this.filterParts(filters);
    const query = {
      TableName: INVENTORY_TABLE,
      IndexName: indexName,
      KeyConditionExpression: `${keyAttr} = :pk`,
      ExpressionAttributeValues: { ':pk': pk, ...f.values },
      ...(f.parts.length > 0 && { FilterExpression: f.parts.join(' AND ') }),
      ...(Object.keys(f.names).length > 0 && { ExpressionAttributeNames: f.names }),
    };

    if (f.parts.length === 0) {
      const result = await this.dynamoDb.client.send(
        new QueryCommand({
          ...query,
          Limit: limit,
          ExclusiveStartKey: this.decodeCursor(cursor),
        }),
      );
      return {
        items: (result.Items || []).map(this.toProduct),
        nextCursor: this.encodeCursor(result.LastEvaluatedKey),
      };
    }

    const skAttr = keyAttr === 'GSI1PK' ? 'GSI1SK' : 'GSI2SK';
    const page = await scanPage<Record<string, unknown>>(
      (input) => this.dynamoDb.client.send(new QueryCommand({ ...query, ...input })),
      limit,
      {
        startKey: this.decodeCursor(cursor),
        keyOf: (i) => ({ PK: i.PK, SK: i.SK, [keyAttr]: i[keyAttr], [skAttr]: i[skAttr] }),
      },
    );
    return {
      items: page.items.map(this.toProduct),
      nextCursor: this.encodeCursor(page.lastKey),
    };
  }

  findByCategory(
    category: string,
    limit: number,
    cursor?: string,
    filters?: ProductListFilters,
  ): Promise<PaginatedResult> {
    return this.queryIndex(GSI1_NAME, 'GSI1PK', `CATEGORY#${category}`, limit, cursor, filters);
  }

  findByType(
    type: string,
    limit: number,
    cursor?: string,
    filters?: ProductListFilters,
  ): Promise<PaginatedResult> {
    return this.queryIndex(GSI2_NAME, 'GSI2PK', `TYPE#${type}`, limit, cursor, filters);
  }

  /**
   * The Scan that selects products, shared by the list and its count so the
   * two can never answer about different populations.
   */
  private listFilter(filters?: ProductListFilters) {
    const f = this.filterParts(filters);
    return {
      expression: ['begins_with(PK, :pk) AND SK = :sk', ...f.parts].join(' AND '),
      values: { ':pk': 'PRODUCT#', ':sk': 'METADATA', ...f.values },
      names: f.names,
    };
  }

  async findAll(
    limit: number,
    cursor?: string,
    filters?: ProductListFilters,
  ): Promise<PaginatedResult> {
    const f = this.listFilter(filters);

    // The table holds far more than products — every SKU#, STOCK#, CONTAINER#
    // and WAREHOUSE# row shares it — so a filtered Scan reads mostly rows it
    // throws away, and `Limit` counts what was read, not what survived. Asking
    // for fifty returned four products (two with a status filter), so the
    // inventory page opened nearly empty. `scanPage` keeps reading until the
    // page is full.
    const page = await scanPage<Record<string, unknown>>(
      (input) =>
        this.dynamoDb.client.send(
          new ScanCommand({
            TableName: INVENTORY_TABLE,
            FilterExpression: f.expression,
            ExpressionAttributeValues: f.values,
            ...(Object.keys(f.names).length > 0 && {
              ExpressionAttributeNames: f.names,
            }),
            ...input,
          }),
        ),
      limit,
      { startKey: this.decodeCursor(cursor), keyOf: (i) => ({ PK: i.PK, SK: i.SK }) },
    );

    return {
      items: page.items.map(this.toProduct),
      nextCursor: this.encodeCursor(page.lastKey),
    };
  }

  /**
   * A count over one index partition, under the same filters the list applies
   * on top of it. Unfiltered, the key already selects the rows and this is the
   * cheap end of counting.
   */
  private countOnIndex(
    indexName: string,
    keyAttr: string,
    pk: string,
    filters?: ProductListFilters,
  ): Promise<CountRowsResult> {
    const f = this.filterParts(filters);
    return countRows((input) =>
      this.dynamoDb.client.send(
        new QueryCommand({
          TableName: INVENTORY_TABLE,
          IndexName: indexName,
          KeyConditionExpression: `${keyAttr} = :pk`,
          ExpressionAttributeValues: { ':pk': pk, ...f.values },
          ...(f.parts.length > 0 && { FilterExpression: f.parts.join(' AND ') }),
          ...(Object.keys(f.names).length > 0 && { ExpressionAttributeNames: f.names }),
          Select: 'COUNT',
          ...input,
        }),
      ),
    );
  }

  countByCategory(category: string, filters?: ProductListFilters): Promise<CountRowsResult> {
    return this.countOnIndex(GSI1_NAME, 'GSI1PK', `CATEGORY#${category}`, filters);
  }

  countByType(type: string, filters?: ProductListFilters): Promise<CountRowsResult> {
    return this.countOnIndex(GSI2_NAME, 'GSI2PK', `TYPE#${type}`, filters);
  }

  /**
   * How many products the list holds — the number behind "Page 2 of 7".
   *
   * `Select: 'COUNT'` keeps the bodies off the wire, and `countRows` bounds
   * the walk: this is a Scan over a table where most rows are not products, so
   * an unbounded count would read all of it on every filter change.
   */
  async countAll(filters?: ProductListFilters): Promise<CountRowsResult> {
    const f = this.listFilter(filters);

    return countRows((input) =>
      this.dynamoDb.client.send(
        new ScanCommand({
          TableName: INVENTORY_TABLE,
          FilterExpression: f.expression,
          ExpressionAttributeValues: f.values,
          ...(Object.keys(f.names).length > 0 && {
            ExpressionAttributeNames: f.names,
          }),
          Select: 'COUNT',
          ...input,
        }),
      ),
    );
  }

  async update(id: string, attrs: Partial<Product>): Promise<Product> {
    const setParts: string[] = [];
    const removeParts: string[] = [];
    const expressionNames: Record<string, string> = {};
    const expressionValues: Record<string, unknown> = {};

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { ...attrs, updatedAt: now };

    // Rebuild GSI keys if category or type changed
    if (attrs.category) {
      updates['GSI1PK'] = `CATEGORY#${attrs.category}`;
      updates['GSI1SK'] = `PRODUCT#${id}`;
    }
    if (attrs.type) {
      updates['GSI2PK'] = `TYPE#${attrs.type}`;
      updates['GSI2SK'] = `PRODUCT#${id}`;
    }

    const immutableKeys = new Set(['id', 'sku']);
    for (const [key, value] of Object.entries(updates)) {
      if (immutableKeys.has(key)) continue;
      const attrName = `#${key}`;
      expressionNames[attrName] = key;
      if (value === undefined && key in attrs) {
        removeParts.push(attrName);
      } else if (value !== undefined) {
        const attrValue = `:${key}`;
        setParts.push(`${attrName} = ${attrValue}`);
        expressionValues[attrValue] = value;
      }
    }

    const expressionSegments: string[] = [];
    if (setParts.length > 0) {
      expressionSegments.push(`SET ${setParts.join(', ')}`);
    }
    if (removeParts.length > 0) {
      expressionSegments.push(`REMOVE ${removeParts.join(', ')}`);
    }

    const result = await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `PRODUCT#${id}`, SK: 'METADATA' },
        UpdateExpression: expressionSegments.join(' '),
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues:
          Object.keys(expressionValues).length > 0
            ? expressionValues
            : undefined,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );

    return this.toProduct(result.Attributes!);
  }

  /**
   * Stored row → entity. Attributes the Workiz import adds (`externalId`,
   * `taxable`, `manageStock`, `customAttributes`…) are carried through: the
   * typed fields are spelled out after the spread, so they always win and the
   * DynamoDB key attributes never leak out.
   *
   * A `type` BitCRM does not know (Workiz `other` / `hours`, 10 items) reads
   * back as `service` — both are non-stockable, so this is the safe side of
   * the `assertStockable` guard — with the original word in `workizType`.
   * Nothing is written here; the mapping is read-only.
   */
  private toProduct(item: Record<string, unknown>): Product {
    const extras: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      if (!KEY_ATTRIBUTES.has(key)) extras[key] = value;
    }

    const storedType = item.type as string | undefined;
    const known = !!storedType && KNOWN_TYPES.has(storedType);
    const workizType =
      (item.workizType as string | undefined) ??
      (storedType && !known ? storedType : undefined);
    // A row with no `type` at all stays untyped so ProductsTypeBackfill still
    // finds it on boot and heals it to `product`.
    const type =
      storedType === undefined
        ? (undefined as unknown as Product['type'])
        : known
          ? (storedType as Product['type'])
          : ProductType.SERVICE;

    return {
      ...extras,
      id: item.id as string,
      number: item.number as number | undefined,
      sku: item.sku as string,
      barcode: item.barcode as string | undefined,
      name: item.name as string,
      description: item.description as string | undefined,
      category: item.category as string,
      type,
      ...(workizType !== undefined && { workizType }),
      costCompany: item.costCompany as number,
      costTech: item.costTech as number,
      priceClient: item.priceClient as number,
      // Rows written before billing have no flag; Workiz default is taxable.
      taxable: item.taxable !== false,
      supplier: item.supplier as string | undefined,
      brandId: item.brandId as string | undefined,
      photoKey: item.photoKey as string | undefined,
      serialTracking: item.serialTracking as boolean,
      minimumStockLevel: item.minimumStockLevel as number,
      manageStock: item.manageStock as boolean | undefined,
      reorderLevel: item.reorderLevel as number | undefined,
      onHand: item.onHand as number | undefined,
      status: item.status as Product['status'],
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    };
  }

  private encodeCursor(
    lastEvaluatedKey?: Record<string, unknown>,
  ): string | undefined {
    if (!lastEvaluatedKey) return undefined;
    return Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64url');
  }

  private decodeCursor(
    cursor?: string,
  ): Record<string, unknown> | undefined {
    if (!cursor) return undefined;
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
  }
}
