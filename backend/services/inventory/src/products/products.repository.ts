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
  GSI2_NAME,
  GSI3_NAME,
  GSI4_NAME,
} from '../common/constants/dynamo.constants';
import { productSearchName, productSearchSku } from './products.constants';
import {
  PRODUCT_CATALOG_INDEX_PK,
  CATALOG_INDEX_MAX_READS,
  expectedCatalogIndexKeys,
  catalogIndexWrite,
  decodeCatalogCursor,
  fillCatalogPage,
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
  /** A filter on every path; only `findByType` (not on the public list) keys on it instead. */
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

/**
 * Rows a filtered read of the stock-managed partition may walk in one request.
 * The partition is ~3 100 products; the budget covers it at any page size, so
 * a search that matches only its last rows still answers on the first page.
 */
const STOCK_INDEX_READ_BUDGET_ROWS = 6000;

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

  /**
   * Moves a product to a new SKU in one transaction: the new `SKU#` claim is
   * taken (refused if another product holds it — a 409), the old claim is
   * dropped (only if it is this product's, or already gone), and the row's
   * `sku` / `searchSku` change — on condition the row still has the old SKU.
   * `generated` marks the new SKU as an internal one (`skuGenerated`); any
   * other SKU clears the mark.
   * Lines, transfers, templates and the log keep the SKU they were written
   * with, as they keep the name.
   */
  async changeSku(
    id: string,
    from: string,
    to: string,
    { generated = false }: { generated?: boolean } = {},
  ): Promise<void> {
    const { TransactWriteCommand } = await import('@aws-sdk/lib-dynamodb');
    try {
      await this.dynamoDb.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: INVENTORY_TABLE,
                Item: { PK: `SKU#${to}`, SK: 'PRODUCT', productId: id },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
            {
              Delete: {
                TableName: INVENTORY_TABLE,
                Key: { PK: `SKU#${from}`, SK: 'PRODUCT' },
                ConditionExpression: 'attribute_not_exists(PK) OR productId = :id',
                ExpressionAttributeValues: { ':id': id },
              },
            },
            {
              Update: {
                TableName: INVENTORY_TABLE,
                Key: { PK: `PRODUCT#${id}`, SK: 'METADATA' },
                // An internal SKU is marked so screens show the field empty;
                // one the user typed clears the mark.
                UpdateExpression: generated
                  ? 'SET #sku = :to, searchSku = :search, updatedAt = :now, skuGenerated = :generated'
                  : 'SET #sku = :to, searchSku = :search, updatedAt = :now REMOVE skuGenerated',
                ConditionExpression: '#sku = :from',
                ExpressionAttributeNames: { '#sku': 'sku' },
                ExpressionAttributeValues: {
                  ':to': to,
                  ':from': from,
                  ':search': productSearchSku(to),
                  ':now': new Date().toISOString(),
                  ...(generated ? { ':generated': true } : {}),
                },
              },
            },
          ],
        }),
      );
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'TransactionCanceledException') {
        const reasons = (error as { CancellationReasons?: { Code?: string }[] }).CancellationReasons;
        if (!reasons || reasons[0]?.Code === 'ConditionalCheckFailed') {
          throw new ConflictException(`Product with SKU "${to}" already exists`);
        }
        throw new ConflictException('The item changed while saving — reopen it and try again');
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
    const skAttr = keyAttr === 'GSI1PK' ? 'GSI1SK' : 'GSI2SK';
    // Decoded before any read: garbage, or a cursor of another index, is a 400, not a 500.
    const startKey = decodeIndexCursor(cursor, ['PK', 'SK', keyAttr, skAttr]);
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
          ExclusiveStartKey: startKey,
        }),
      );
      return {
        items: (result.Items || []).map(this.toProduct),
        nextCursor: encodeIndexCursor(result.LastEvaluatedKey),
      };
    }

    const page = await fillPage<Record<string, unknown>>(
      (input) => this.dynamoDb.client.send(new QueryCommand({ ...query, ...input })),
      limit,
      {
        startKey,
        keyOf: (i) => ({ PK: i.PK, SK: i.SK, [keyAttr]: i[keyAttr], [skAttr]: i[skAttr] }),
      },
    );
    return {
      items: page.items.map(this.toProduct),
      nextCursor: encodeIndexCursor(page.lastKey),
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
    // Decoded before any read: a garbage cursor is a 400, not a 500.
    const startKey = decodeIndexCursor(cursor, ['PK', 'SK']);

    // The table holds far more than products — every SKU#, STOCK#, CONTAINER#
    // and WAREHOUSE# row shares it — so a filtered Scan reads mostly rows it
    // throws away, and `Limit` counts what was read, not what survived. Asking
    // for fifty returned four products (two with a status filter), so the
    // inventory page opened nearly empty. `fillPage` keeps reading until the
    // page is full.
    const page = await fillPage<Record<string, unknown>>(
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
      { startKey, keyOf: (i) => ({ PK: i.PK, SK: i.SK }) },
    );

    return {
      items: page.items.map(this.toProduct),
      nextCursor: encodeIndexCursor(page.lastKey),
    };
  }

  /**
   * The Query on the stock-managed partition, shared by the list and its count
   * so the two can never answer about different populations.
   */
  private stockManagedQuery(filters?: StockManagedFilters) {
    const f = this.filterParts(filters);
    return {
      TableName: INVENTORY_TABLE,
      IndexName: GSI3_NAME,
      KeyConditionExpression: 'GSI3PK = :pk',
      ExpressionAttributeValues: { ':pk': PRODUCT_STOCK_INDEX_PK, ...f.values },
      ...(f.parts.length > 0 && { FilterExpression: f.parts.join(' AND ') }),
      ...(Object.keys(f.names).length > 0 && { ExpressionAttributeNames: f.names }),
      hasFilter: f.parts.length > 0,
    };
  }

  /**
   * Workiz's "inventory products": the stock-managed partition in name order,
   * the other filters on top. Unfiltered it is one Query per page; filtered,
   * the page is filled across reads within a budget that covers the whole
   * partition, so a rare search term never answers an empty page with a
   * cursor — which the Scan over the shared table did.
   */
  async findStockManaged(
    limit: number,
    cursor?: string,
    filters?: StockManagedFilters,
  ): Promise<PaginatedResult> {
    const { hasFilter, ...query } = this.stockManagedQuery(filters);
    // Decoded before any read: a Scan-era or foreign cursor is a 400, not a 500.
    const startKey = decodeIndexCursor(cursor, STOCK_CURSOR_KEYS);

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

    const page = await fillPage<Record<string, unknown>>(
      (input) =>
        this.dynamoDb.client.send(new QueryCommand({ ...query, ScanIndexForward: true, ...input })),
      limit,
      {
        startKey,
        maxReads: Math.max(20, Math.ceil(STOCK_INDEX_READ_BUDGET_ROWS / (limit * 10))),
        keyOf: (i) => ({ PK: i.PK, SK: i.SK, GSI3PK: i.GSI3PK, GSI3SK: i.GSI3SK }),
      },
    );
    return {
      items: page.items.map(this.toProduct),
      nextCursor: encodeIndexCursor(page.lastKey),
    };
  }

  /** How many stock-managed products the filters select — the count of `findStockManaged`. */
  countStockManaged(filters?: StockManagedFilters): Promise<CountRowsResult> {
    const { hasFilter: _hasFilter, ...query } = this.stockManagedQuery(filters);
    return countRows((input) =>
      this.dynamoDb.client.send(new QueryCommand({ ...query, Select: 'COUNT', ...input })),
    );
  }

  /**
   * The Query on the Price Book partition, shared by the list and its count
   * so the two can never answer about different populations.
   */
  private catalogQuery(filters?: ProductListFilters) {
    const f = this.filterParts(filters);
    return {
      TableName: INVENTORY_TABLE,
      IndexName: GSI4_NAME,
      KeyConditionExpression: 'GSI4PK = :pk',
      ExpressionAttributeValues: { ':pk': PRODUCT_CATALOG_INDEX_PK, ...f.values },
      ...(f.parts.length > 0 && { FilterExpression: f.parts.join(' AND ') }),
      ...(Object.keys(f.names).length > 0 && { ExpressionAttributeNames: f.names }),
      hasFilter: f.parts.length > 0,
    };
  }

  /**
   * The Price Book: every item — products, services, active and archived — in
   * name order off the GSI4 `PRODUCTS#ALL` partition, the other filters (type,
   * status, search, brand, `manageStock=false`) on top. Unfiltered it is one
   * Query per page; filtered, the page is filled with 1 MB reads within a
   * budget that covers the whole ~16k-row partition, so a rare search term
   * never answers an empty page with a cursor — which the Scan over the shared
   * table did.
   */
  async findCatalog(
    limit: number,
    cursor?: string,
    filters?: ProductListFilters,
  ): Promise<PaginatedResult> {
    const { hasFilter, ...query } = this.catalogQuery(filters);
    // Decoded before any read: a Scan-era, stock-partition or foreign cursor is a 400, not a 500.
    const startKey = decodeCatalogCursor(cursor);

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

    const page = await fillCatalogPage<Record<string, unknown>>(
      (input) =>
        this.dynamoDb.client.send(new QueryCommand({ ...query, ScanIndexForward: true, ...input })),
      limit,
      {
        startKey,
        keyOf: (i) => ({ PK: i.PK, SK: i.SK, GSI4PK: i.GSI4PK, GSI4SK: i.GSI4SK }),
      },
    );
    return {
      items: page.items.map(this.toProduct),
      nextCursor: encodeIndexCursor(page.lastKey),
    };
  }

  /**
   * How many items the Price Book filters select — the count of `findCatalog`.
   * The whole partition is ~16 MB, past `countRows`' default twenty 1 MB
   * reads, so it is given the catalog budget and answers exactly.
   */
  countCatalog(filters?: ProductListFilters): Promise<CountRowsResult> {
    const { hasFilter: _hasFilter, ...query } = this.catalogQuery(filters);
    return countRows(
      (input) => this.dynamoDb.client.send(new QueryCommand({ ...query, Select: 'COUNT', ...input })),
      { maxReads: CATALOG_INDEX_MAX_READS },
    );
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
