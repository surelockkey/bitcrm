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
import { DynamoDbService, countRows, type CountRowsResult } from '@bitcrm/shared';
import { type Product, ProductType } from '@bitcrm/types';
import {
  INVENTORY_TABLE,
  GSI1_NAME,
  GSI3_NAME,
  GSI4_NAME,
} from '../common/constants/dynamo.constants';
import {
  PRODUCT_INDEX_MAX_READS,
  PRODUCT_INDEX_READ_ROWS,
  productSearchName,
  productSearchSku,
} from './products.constants';
import {
  PRODUCT_CATALOG_INDEX_PK,
  expectedCatalogIndexKeys,
  catalogIndexWrite,
  decodeCatalogCursor,
  type CatalogIndexRow,
} from './product-catalog-index';
import {
  PRODUCT_STOCK_INDEX_PK,
  expectedStockIndexKeys,
  stockIndexWrite,
  type StockIndexRow,
} from './product-stock-index';
import { decodeIndexCursor, encodeIndexCursor } from '../common/utils/index-cursor';
import { batchGetAll, type BatchGetOptions } from '../common/utils/batch-get';
import { fillPage } from '../common/utils/fill-page';

export interface PaginatedResult {
  items: Product[];
  nextCursor?: string;
}

/**
 * The filters a list and its count share. Whichever partition picks the rows
 * (a category, the stock-managed one, the Price Book one), every one of these
 * is applied on top as a FilterExpression.
 */
export interface ProductListFilters {
  /** A filter on every path — no list keys on the type. */
  type?: string;
  status?: string;
  /** Matched against the lowercased `name` and `sku` (`searchName` / `searchSku`), case-insensitive. */
  search?: string;
  brandId?: string;
  /**
   * `true` selects stock-managed products (product-type rows whose flag is
   * absent or true — services are never stock-managed); `false` selects the
   * rows that say `manageStock: false` explicitly.
   */
  manageStock?: boolean;
}

/** Key and derived attributes that must never leak onto an entity. */
const KEY_ATTRIBUTES = new Set([
  'PK', 'SK', 'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK', 'GSI3PK', 'GSI3SK', 'GSI4PK', 'GSI4SK',
  'searchName', 'searchSku',
]);

const KNOWN_TYPES = new Set<string>(Object.values(ProductType));

/** A cursor of the stock-managed Query names the table keys and the GSI3 keys. */
const STOCK_CURSOR_KEYS = ['PK', 'SK', 'GSI3PK', 'GSI3SK'] as const;

/** A cursor of a category Query names the table keys and the GSI1 keys. */
const CATEGORY_CURSOR_KEYS = ['PK', 'SK', 'GSI1PK', 'GSI1SK'] as const;

/** One index partition the product lists read. */
interface ProductPartition {
  indexName: string;
  pkAttr: 'GSI1PK' | 'GSI3PK' | 'GSI4PK';
  skAttr: 'GSI1SK' | 'GSI3SK' | 'GSI4SK';
}

const CATEGORY_PARTITION: ProductPartition = { indexName: GSI1_NAME, pkAttr: 'GSI1PK', skAttr: 'GSI1SK' };
const STOCK_PARTITION: ProductPartition = { indexName: GSI3_NAME, pkAttr: 'GSI3PK', skAttr: 'GSI3SK' };
const CATALOG_PARTITION: ProductPartition = { indexName: GSI4_NAME, pkAttr: 'GSI4PK', skAttr: 'GSI4SK' };

/** The filters the stock-managed partition takes — manageStock is the partition itself. */
export type StockManagedFilters = Omit<ProductListFilters, 'manageStock'>;

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
 *   GSI3PK = PRODUCTS#STOCK, GSI3SK = <name lowercased>#<id>  (OwnerIndex, sparse:
 *     stock-managed products only — type `product`, `manageStock` not false,
 *     any status; the "inventory products" list, name order.
 *     `backfill:product-stock-index` fills older rows; every update re-files one)
 *   GSI4PK = PRODUCTS#ALL, GSI4SK = <name lowercased, first 200 chars>#<id>
 *     (TransferEntityIndex: EVERY product — any type, any status, any stock
 *     flag; the Price Book list, name order. `backfill:product-catalog-index`
 *     fills older rows; every update re-files one)
 *   searchName = <name lowercased>, searchSku = <sku lowercased>  (what the
 *     search filter matches; `backfill:product-search` fills older rows)
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
                  ...expectedStockIndexKeys({
                    ...product,
                    PK: `PRODUCT#${product.id}`,
                    SK: 'METADATA',
                  }),
                  ...expectedCatalogIndexKeys({
                    ...product,
                    PK: `PRODUCT#${product.id}`,
                    SK: 'METADATA',
                  }),
                  searchName: productSearchName(product.name),
                  searchSku: productSearchSku(product.sku),
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

  /**
   * The products these ids name, each read once, 100 keys a BatchGet (a few
   * in flight, with the shared bounded retry of unprocessed keys). An id with
   * no row is simply absent; order is not kept. `attributes` reads only those
   * fields — the answer then carries nothing else, so ask for `id`.
   */
  async findByIds(ids: string[], options: BatchGetOptions = {}): Promise<Product[]> {
    const keys = [...new Set(ids)].map((id) => ({ PK: `PRODUCT#${id}`, SK: 'METADATA' }));
    const rows = await batchGetAll(this.dynamoDb.client, keys, options);
    return rows.map((row) => this.toProduct(row));
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
    if (filters?.search?.trim()) {
      parts.push('(contains(searchName, :search) OR contains(searchSku, :search))');
      values[':search'] = productSearchName(filters.search);
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
   * The Query on one product partition — a category, the stock-managed one or
   * the Price Book one — with the list filters on top, shared by each list and
   * its count so the two can never answer about different populations.
   */
  private partitionQuery(partition: ProductPartition, pk: string, filters?: ProductListFilters) {
    const f = this.filterParts(filters);
    return {
      TableName: INVENTORY_TABLE,
      IndexName: partition.indexName,
      KeyConditionExpression: `${partition.pkAttr} = :pk`,
      ExpressionAttributeValues: { ':pk': pk, ...f.values },
      ...(f.parts.length > 0 && { FilterExpression: f.parts.join(' AND ') }),
      ...(Object.keys(f.names).length > 0 && { ExpressionAttributeNames: f.names }),
      hasFilter: f.parts.length > 0,
    };
  }

  /**
   * One page of a product partition. Unfiltered it is a single Query of
   * exactly `limit` rows. Filtered, `Limit` counts rows read rather than kept,
   * so the page is filled with 1 MB reads within the budget that covers the
   * largest partition — a rare search term never answers a short or empty
   * page with a cursor — and cut at `limit`, the cursor carrying the table
   * keys and the index keys of the last row kept.
   */
  private async listPartition(
    partition: ProductPartition,
    pk: string,
    limit: number,
    startKey: Record<string, unknown> | undefined,
    filters?: ProductListFilters,
  ): Promise<PaginatedResult> {
    const { hasFilter, ...query } = this.partitionQuery(partition, pk, filters);

    if (!hasFilter) {
      const result = await this.dynamoDb.client.send(
        new QueryCommand({
          ...query,
          ScanIndexForward: true,
          Limit: limit,
          ...(startKey ? { ExclusiveStartKey: startKey } : {}),
        }),
      );
      return {
        items: (result.Items || []).map(this.toProduct),
        nextCursor: encodeIndexCursor(result.LastEvaluatedKey),
      };
    }

    const { pkAttr, skAttr } = partition;
    const page = await fillPage<Record<string, unknown>>(
      (input) =>
        this.dynamoDb.client.send(new QueryCommand({ ...query, ScanIndexForward: true, ...input })),
      limit,
      {
        startKey,
        readRows: PRODUCT_INDEX_READ_ROWS,
        maxReads: PRODUCT_INDEX_MAX_READS,
        keyOf: (i) => ({ PK: i.PK, SK: i.SK, [pkAttr]: i[pkAttr], [skAttr]: i[skAttr] }),
      },
    );
    return {
      items: page.items.map(this.toProduct),
      nextCursor: encodeIndexCursor(page.lastKey),
    };
  }

  /**
   * How many rows of a product partition the filters select, without bodies.
   * The largest partition is ~16 MB, past `countRows`' default twenty 1 MB
   * reads, so every product count gets the partition budget and answers
   * exactly. Unfiltered, the key already selects the rows.
   */
  private countPartition(
    partition: ProductPartition,
    pk: string,
    filters?: ProductListFilters,
  ): Promise<CountRowsResult> {
    const { hasFilter: _hasFilter, ...query } = this.partitionQuery(partition, pk, filters);
    return countRows(
      (input) => this.dynamoDb.client.send(new QueryCommand({ ...query, Select: 'COUNT', ...input })),
      { maxReads: PRODUCT_INDEX_MAX_READS },
    );
  }

  /** One category (CategoryIndex), every other filter on top. */
  async findByCategory(
    category: string,
    limit: number,
    cursor?: string,
    filters?: ProductListFilters,
  ): Promise<PaginatedResult> {
    // Decoded before any read: garbage, or a cursor of another index, is a 400, not a 500.
    const startKey = decodeIndexCursor(cursor, CATEGORY_CURSOR_KEYS);
    return this.listPartition(CATEGORY_PARTITION, `CATEGORY#${category}`, limit, startKey, filters);
  }

  countByCategory(category: string, filters?: ProductListFilters): Promise<CountRowsResult> {
    return this.countPartition(CATEGORY_PARTITION, `CATEGORY#${category}`, filters);
  }

  /**
   * Every product row, in table order, one filled page at a time — the
   * internal walk (`GET /products/internal/all`, the search indexer) and the
   * boot-time type heal. No filters: the public list reads the partitions.
   */
  async findAll(limit: number, cursor?: string): Promise<PaginatedResult> {
    // Decoded before any read: a garbage cursor is a 400, not a 500.
    const startKey = decodeIndexCursor(cursor, ['PK', 'SK']);

    // The table holds far more than products — every SKU#, STOCK#, CONTAINER#
    // and WAREHOUSE# row shares it — so a filtered Scan reads mostly rows it
    // throws away, and `Limit` counts what was read, not what survived.
    // `fillPage` keeps reading until the page is full.
    const page = await fillPage<Record<string, unknown>>(
      (input) =>
        this.dynamoDb.client.send(
          new ScanCommand({
            TableName: INVENTORY_TABLE,
            FilterExpression: 'begins_with(PK, :pk) AND SK = :sk',
            ExpressionAttributeValues: { ':pk': 'PRODUCT#', ':sk': 'METADATA' },
            ...input,
          }),
        ),
      limit,
      { startKey, keyOf: (i) => ({ PK: i.PK, SK: i.SK }) },
    );

    return {
      items: page.items.map(this.toProduct),
      nextCursor: encodeIndexCursor(page.lastKey),
    };
  }

  /**
   * Workiz's "inventory products": the stock-managed partition, the other
   * filters on top — read the way every product partition is (`listPartition`).
   */
  async findStockManaged(
    limit: number,
    cursor?: string,
    filters?: StockManagedFilters,
  ): Promise<PaginatedResult> {
    // Decoded before any read: a Scan-era or foreign cursor is a 400, not a 500.
    const startKey = decodeIndexCursor(cursor, STOCK_CURSOR_KEYS);
    return this.listPartition(STOCK_PARTITION, PRODUCT_STOCK_INDEX_PK, limit, startKey, filters);
  }

  /** How many stock-managed products the filters select — the count of `findStockManaged`. */
  countStockManaged(filters?: StockManagedFilters): Promise<CountRowsResult> {
    return this.countPartition(STOCK_PARTITION, PRODUCT_STOCK_INDEX_PK, filters);
  }

  /**
   * The Price Book: every item — products, services, active and archived —
   * off the GSI4 `PRODUCTS#ALL` partition, the other filters (type, status,
   * search, brand, `manageStock=false`) on top.
   */
  async findCatalog(
    limit: number,
    cursor?: string,
    filters?: ProductListFilters,
  ): Promise<PaginatedResult> {
    // Decoded before any read: a Scan-era, stock-partition or foreign cursor is a 400, not a 500.
    const startKey = decodeCatalogCursor(cursor);
    return this.listPartition(CATALOG_PARTITION, PRODUCT_CATALOG_INDEX_PK, limit, startKey, filters);
  }

  /** How many items the Price Book filters select — the count of `findCatalog`. */
  countCatalog(filters?: ProductListFilters): Promise<CountRowsResult> {
    return this.countPartition(CATALOG_PARTITION, PRODUCT_CATALOG_INDEX_PK, filters);
  }

  /**
   * Writes only the attributes it is given. One given as `null` (a field the
   * API cleared) or as an explicit `undefined` (the CSV re-import) is
   * REMOVEd — never stored as a DynamoDB NULL.
   */
  async update(
    id: string,
    attrs: Partial<{ [K in keyof Product]: Product[K] | null }>,
  ): Promise<Product> {
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
    // The SKU is immutable, so only the name's search attribute can go stale.
    if (typeof attrs.name === 'string') {
      updates['searchName'] = productSearchName(attrs.name);
    }

    const immutableKeys = new Set(['id', 'sku']);
    for (const [key, value] of Object.entries(updates)) {
      if (immutableKeys.has(key)) continue;
      const attrName = `#${key}`;
      expressionNames[attrName] = key;
      if (value === null || (value === undefined && key in attrs)) {
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

    const row = result.Attributes!;
    // Disjoint attributes and conditions, so the two filings run side by side.
    await Promise.all([
      this.syncStockIndex(row as StockIndexRow),
      this.syncCatalogIndex(row as CatalogIndexRow),
    ]);
    return this.toProduct(row);
  }

  /**
   * Whatever an update changed — the name, the type, the `manageStock` flag
   * (a `null` clearing it means managed) — the row leaves filed correctly on
   * the stock-managed partition, or taken off it. A row written before the
   * partition existed is filed by any edit. The write is conditioned on the
   * row still being what this update produced; if another write landed in
   * between, that one files the row, so a refusal is not an error.
   */
  private async syncStockIndex(row: StockIndexRow): Promise<void> {
    const write = stockIndexWrite(row);
    if (!write) return;
    const { kind: _kind, ...input } = write;
    try {
      await this.dynamoDb.client.send(new UpdateCommand({ TableName: INVENTORY_TABLE, ...input }));
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return;
      throw error;
    }
  }

  /**
   * The same for the Price Book partition: a rename moves the row to its new
   * place in name order, and a row written before the partition existed is
   * filed by any edit. Conditioned on the name and sort key this update
   * produced; a refused write lost to a later one, which files the row itself.
   */
  private async syncCatalogIndex(row: CatalogIndexRow): Promise<void> {
    const write = catalogIndexWrite(row);
    if (!write) return;
    try {
      await this.dynamoDb.client.send(new UpdateCommand({ TableName: INVENTORY_TABLE, ...write }));
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return;
      throw error;
    }
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
}
