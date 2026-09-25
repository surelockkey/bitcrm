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

/** Key attributes that must never leak onto an entity. */
const KEY_ATTRIBUTES = new Set([
  'PK', 'SK', 'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK', 'GSI3PK', 'GSI3SK', 'GSI4PK', 'GSI4SK',
]);

const KNOWN_TYPES = new Set<string>(Object.values(ProductType));

@Injectable()
export class ProductsRepository {
  private readonly rawClient: DynamoDBClient;

  constructor(private readonly dynamoDb: DynamoDbService) {
    // We need the raw client for TransactWriteItems (not available in DocumentClient)
    this.rawClient = (this.dynamoDb.client as any).config?.client || this.dynamoDb.client;
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

  async findByCategory(
    category: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedResult> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: INVENTORY_TABLE,
        IndexName: GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `CATEGORY#${category}` },
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    return {
      items: (result.Items || []).map(this.toProduct),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  async findByType(
    type: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedResult> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: INVENTORY_TABLE,
        IndexName: GSI2_NAME,
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: { ':pk': `TYPE#${type}` },
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    return {
      items: (result.Items || []).map(this.toProduct),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  /**
   * The Scan that selects products, shared by the list and its count so the
   * two can never answer about different populations.
   */
  private listFilter(filters?: { status?: string; search?: string }) {
    let expression = 'begins_with(PK, :pk) AND SK = :sk';
    const values: Record<string, unknown> = {
      ':pk': 'PRODUCT#',
      ':sk': 'METADATA',
    };
    const names: Record<string, string> = {};

    if (filters?.status) {
      expression += ' AND #status = :status';
      names['#status'] = 'status';
      values[':status'] = filters.status;
    }

    if (filters?.search) {
      expression += ' AND (contains(#name, :search) OR contains(sku, :search))';
      names['#name'] = 'name';
      values[':search'] = filters.search;
    }

    return { expression, values, names };
  }

  async findAll(
    limit: number,
    cursor?: string,
    filters?: { status?: string; search?: string },
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
   * How many products the list holds — the number behind "Page 2 of 7".
   *
   * `Select: 'COUNT'` keeps the bodies off the wire, and `countRows` bounds
   * the walk: this is a Scan over a table where most rows are not products, so
   * an unbounded count would read all of it on every filter change.
   */
  /**
   * A count over one index partition. No Scan and no filter — the key already
   * selects the rows — so this is the cheap end of counting.
   */
  private countOnIndex(indexName: string, keyAttr: string, pk: string): Promise<CountRowsResult> {
    return countRows((input) =>
      this.dynamoDb.client.send(
        new QueryCommand({
          TableName: INVENTORY_TABLE,
          IndexName: indexName,
          KeyConditionExpression: `${keyAttr} = :pk`,
          ExpressionAttributeValues: { ':pk': pk },
          Select: 'COUNT',
          ...input,
        }),
      ),
    );
  }

  countByCategory(category: string): Promise<CountRowsResult> {
    return this.countOnIndex(GSI1_NAME, 'GSI1PK', `CATEGORY#${category}`);
  }

  countByType(type: string): Promise<CountRowsResult> {
    return this.countOnIndex(GSI2_NAME, 'GSI2PK', `TYPE#${type}`);
  }

  async countAll(filters?: { status?: string; search?: string }): Promise<CountRowsResult> {
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
      photoKey: item.photoKey as string | undefined,
      serialTracking: item.serialTracking as boolean,
      minimumStockLevel: item.minimumStockLevel as number,
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
