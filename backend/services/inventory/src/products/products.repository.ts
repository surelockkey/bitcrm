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
import { DynamoDbService } from '@bitcrm/shared';
import { type Product } from '@bitcrm/types';
import {
  INVENTORY_TABLE,
  GSI1_NAME,
  GSI2_NAME,
} from '../common/constants/dynamo.constants';

export interface PaginatedResult {
  items: Product[];
  nextCursor?: string;
}

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

  async findAll(
    limit: number,
    cursor?: string,
    filters?: { status?: string; search?: string },
  ): Promise<PaginatedResult> {
    let filterExpression = 'begins_with(PK, :pk) AND SK = :sk';
    const expressionValues: Record<string, unknown> = {
      ':pk': 'PRODUCT#',
      ':sk': 'METADATA',
    };
    const expressionNames: Record<string, string> = {};

    if (filters?.status) {
      filterExpression += ' AND #status = :status';
      expressionNames['#status'] = 'status';
      expressionValues[':status'] = filters.status;
    }

    if (filters?.search) {
      filterExpression += ' AND (contains(#name, :search) OR contains(sku, :search))';
      expressionNames['#name'] = 'name';
      expressionValues[':search'] = filters.search;
    }

    const result = await this.dynamoDb.client.send(
      new ScanCommand({
        TableName: INVENTORY_TABLE,
        FilterExpression: filterExpression,
        ExpressionAttributeValues: expressionValues,
        ...(Object.keys(expressionNames).length > 0 && {
          ExpressionAttributeNames: expressionNames,
        }),
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    return {
      items: (result.Items || []).map(this.toProduct),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
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

  private toProduct(item: Record<string, unknown>): Product {
    return {
      id: item.id as string,
      sku: item.sku as string,
      barcode: item.barcode as string | undefined,
      name: item.name as string,
      description: item.description as string | undefined,
      category: item.category as string,
      type: item.type as Product['type'],
      costCompany: item.costCompany as number,
      costTech: item.costTech as number,
      priceClient: item.priceClient as number,
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
