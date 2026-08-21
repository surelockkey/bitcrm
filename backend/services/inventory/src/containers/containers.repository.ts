import { Injectable } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type Container } from '@bitcrm/types';
import {
  INVENTORY_TABLE,
  GSI3_NAME,
} from '../common/constants/dynamo.constants';

export interface PaginatedResult {
  items: Container[];
  nextCursor?: string;
}

@Injectable()
export class ContainersRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async create(container: Container): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: INVENTORY_TABLE,
        Item: {
          PK: `CONTAINER#${container.id}`,
          SK: 'METADATA',
          GSI3PK: `OWNER#${container.technicianId}`,
          GSI3SK: `CONTAINER#${container.id}`,
          ...container,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }

  async findById(id: string): Promise<Container | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `CONTAINER#${id}`, SK: 'METADATA' },
      }),
    );

    if (!result.Item) return null;
    return this.toContainer(result.Item);
  }

  async findByTechnicianId(technicianId: string): Promise<Container | null> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: INVENTORY_TABLE,
        IndexName: GSI3_NAME,
        KeyConditionExpression: 'GSI3PK = :pk',
        ExpressionAttributeValues: { ':pk': `OWNER#${technicianId}` },
        Limit: 1,
      }),
    );

    const items = result.Items || [];
    if (items.length === 0) return null;
    return this.toContainer(items[0]);
  }

  async findAll(
    limit: number,
    cursor?: string,
    filters?: { department?: string },
  ): Promise<PaginatedResult> {
    let filterExpression = 'begins_with(PK, :pk) AND SK = :sk';
    const expressionValues: Record<string, unknown> = {
      ':pk': 'CONTAINER#',
      ':sk': 'METADATA',
    };
    const expressionNames: Record<string, string> = {};

    if (filters?.department) {
      filterExpression += ' AND #department = :dept';
      expressionNames['#department'] = 'department';
      expressionValues[':dept'] = filters.department;
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
      items: (result.Items || []).map(this.toContainer),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  async update(id: string, attrs: Partial<Container>): Promise<Container> {
    const setParts: string[] = [];
    const expressionNames: Record<string, string> = {};
    const expressionValues: Record<string, unknown> = {};

    const updates = { ...attrs, updatedAt: new Date().toISOString() };
    const immutableKeys = new Set(['id', 'technicianId']);

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
        Key: { PK: `CONTAINER#${id}`, SK: 'METADATA' },
        UpdateExpression: `SET ${setParts.join(', ')}`,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: expressionValues,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );

    return this.toContainer(result.Attributes!);
  }

  private toContainer(item: Record<string, unknown>): Container {
    return {
      id: item.id as string,
      technicianId: item.technicianId as string,
      technicianName: item.technicianName as string,
      department: item.department as string,
      status: item.status as Container['status'],
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
