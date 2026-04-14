import { Injectable } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type User, UserStatus } from '@bitcrm/types';
import { USERS_TABLE, GSI1_NAME, GSI2_NAME } from './constants/dynamo.constants';

interface PaginatedResult {
  items: User[];
  nextCursor?: string;
}

@Injectable()
export class UsersRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async create(user: User): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: USERS_TABLE,
        Item: {
          PK: `USER#${user.id}`,
          SK: 'METADATA',
          GSI1PK: `ROLE_USER#${user.roleId}`,
          GSI1SK: `USER#${user.id}`,
          GSI2PK: `DEPT#${user.department}`,
          GSI2SK: `USER#${user.id}`,
          ...user,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }

  async findById(id: string): Promise<User | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: USERS_TABLE,
        Key: { PK: `USER#${id}`, SK: 'METADATA' },
      }),
    );

    if (!result.Item) return null;
    return this.toUser(result.Item);
  }

  async findByRole(
    role: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedResult> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: USERS_TABLE,
        IndexName: GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `ROLE_USER#${role}` },
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    return {
      items: (result.Items || []).map(this.toUser),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  async findByDepartment(
    department: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedResult> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: USERS_TABLE,
        IndexName: GSI2_NAME,
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: { ':pk': `DEPT#${department}` },
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    return {
      items: (result.Items || []).map(this.toUser),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  async findAll(limit: number, cursor?: string): Promise<PaginatedResult> {
    const result = await this.dynamoDb.client.send(
      new ScanCommand({
        TableName: USERS_TABLE,
        FilterExpression: 'begins_with(PK, :pk) AND SK = :sk',
        ExpressionAttributeValues: { ':pk': 'USER#', ':sk': 'METADATA' },
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    return {
      items: (result.Items || []).map(this.toUser),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  async findByStatus(
    status: UserStatus,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedResult> {
    const result = await this.dynamoDb.client.send(
      new ScanCommand({
        TableName: USERS_TABLE,
        FilterExpression:
          'begins_with(PK, :pk) AND SK = :sk AND #status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':pk': 'USER#',
          ':sk': 'METADATA',
          ':status': status,
        },
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    return {
      items: (result.Items || []).map(this.toUser),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  async update(id: string, attrs: Partial<User>): Promise<User> {
    const setParts: string[] = [];
    const removeParts: string[] = [];
    const expressionNames: Record<string, string> = {};
    const expressionValues: Record<string, unknown> = {};

    const now = new Date().toISOString();
    const updates = { ...attrs, updatedAt: now };

    // Rebuild GSI keys if roleId or department changed
    if (attrs.roleId) {
      updates['GSI1PK' as keyof typeof updates] = `ROLE_USER#${attrs.roleId}` as never;
      updates['GSI1SK' as keyof typeof updates] = `USER#${id}` as never;
    }
    if (attrs.department) {
      updates['GSI2PK' as keyof typeof updates] = `DEPT#${attrs.department}` as never;
      updates['GSI2SK' as keyof typeof updates] = `USER#${id}` as never;
    }

    const immutableKeys = new Set(['id', 'cognitoSub', 'email']);
    for (const [key, value] of Object.entries(updates)) {
      if (immutableKeys.has(key)) continue;
      const attrName = `#${key}`;
      expressionNames[attrName] = key;
      if (value === undefined) {
        // Use REMOVE for undefined values to clear the attribute
        // Only remove explicitly passed keys (not updatedAt)
        if (key in attrs) {
          removeParts.push(attrName);
        }
      } else {
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
        TableName: USERS_TABLE,
        Key: { PK: `USER#${id}`, SK: 'METADATA' },
        UpdateExpression: expressionSegments.join(' '),
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: Object.keys(expressionValues).length > 0 ? expressionValues : undefined,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );

    return this.toUser(result.Attributes!);
  }

  async findByRoleId(roleId: string): Promise<User[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: USERS_TABLE,
        IndexName: GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `ROLE_USER#${roleId}` },
      }),
    );

    return (result.Items || []).map(this.toUser);
  }

  private toUser(item: Record<string, unknown>): User {
    return {
      id: item.id as string,
      cognitoSub: item.cognitoSub as string,
      email: item.email as string,
      firstName: item.firstName as string,
      lastName: item.lastName as string,
      roleId: (item.roleId as string) || '',
      department: item.department as string,
      status: item.status as User['status'],
      permissionOverrides: item.permissionOverrides as User['permissionOverrides'],
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
