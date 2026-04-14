import { Injectable } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type Warehouse } from '@bitcrm/types';
import { INVENTORY_TABLE } from '../common/constants/dynamo.constants';

export interface PaginatedResult {
  items: Warehouse[];
  nextCursor?: string;
}

@Injectable()
export class WarehousesRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async create(warehouse: Warehouse): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: INVENTORY_TABLE,
        Item: {
          PK: `WAREHOUSE#${warehouse.id}`,
          SK: 'METADATA',
          ...warehouse,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }

  async findById(id: string): Promise<Warehouse | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `WAREHOUSE#${id}`, SK: 'METADATA' },
      }),
    );

    if (!result.Item) return null;
    return this.toWarehouse(result.Item);
  }

  async findAll(limit: number, cursor?: string): Promise<PaginatedResult> {
    const result = await this.dynamoDb.client.send(
      new ScanCommand({
        TableName: INVENTORY_TABLE,
        FilterExpression: 'begins_with(PK, :pk) AND SK = :sk',
        ExpressionAttributeValues: { ':pk': 'WAREHOUSE#', ':sk': 'METADATA' },
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    return {
      items: (result.Items || []).map(this.toWarehouse),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  async update(id: string, attrs: Partial<Warehouse>): Promise<Warehouse> {
    const setParts: string[] = [];
    const expressionNames: Record<string, string> = {};
    const expressionValues: Record<string, unknown> = {};

    const updates = { ...attrs, updatedAt: new Date().toISOString() };
    const immutableKeys = new Set(['id']);

    for (const [key, value] of Object.entries(updates)) {
      if (immutableKeys.has(key) || value === undefined) continue;
      const attrName = `#${key}`;
      const attrValue = `:${key}`;
      expressionNames[attrName] = key;
      setParts.push(`${attrName} = ${attrValue}`);
      expressionValues[attrValue] = value;
    }

    const result = await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `WAREHOUSE#${id}`, SK: 'METADATA' },
        UpdateExpression: `SET ${setParts.join(', ')}`,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: expressionValues,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );

    return this.toWarehouse(result.Attributes!);
  }

  private toWarehouse(item: Record<string, unknown>): Warehouse {
    return {
      id: item.id as string,
      name: item.name as string,
      address: item.address as string | undefined,
      description: item.description as string | undefined,
      status: item.status as Warehouse['status'],
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
