import { Injectable } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type Role } from '@bitcrm/types';
import { ROLES_TABLE, ROLES_GSI1_NAME } from './constants/dynamo.constants';

@Injectable()
export class RolesRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async create(role: Role): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: ROLES_TABLE,
        Item: {
          PK: `ROLE#${role.id}`,
          SK: 'METADATA',
          GSI1PK: 'ROLE_ENTITY',
          GSI1SK: `ROLE#${role.id}`,
          ...role,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }

  async findById(id: string): Promise<Role | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: ROLES_TABLE,
        Key: { PK: `ROLE#${id}`, SK: 'METADATA' },
      }),
    );

    if (!result.Item) return null;
    return this.toRole(result.Item);
  }

  async findAll(): Promise<Role[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: ROLES_TABLE,
        IndexName: ROLES_GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': 'ROLE_ENTITY' },
      }),
    );

    return (result.Items || []).map((item) => this.toRole(item));
  }

  async findByName(name: string): Promise<Role | null> {
    const result = await this.dynamoDb.client.send(
      new ScanCommand({
        TableName: ROLES_TABLE,
        FilterExpression: 'begins_with(PK, :prefix) AND #name = :name',
        ExpressionAttributeNames: { '#name': 'name' },
        ExpressionAttributeValues: {
          ':prefix': 'ROLE#',
          ':name': name,
        },
      }),
    );

    if (!result.Items || result.Items.length === 0) return null;
    return this.toRole(result.Items[0]);
  }

  async update(id: string, attrs: Partial<Role>): Promise<Role> {
    const expressionParts: string[] = [];
    const expressionNames: Record<string, string> = {};
    const expressionValues: Record<string, unknown> = {};

    const now = new Date().toISOString();
    const updates = { ...attrs, updatedAt: now };

    for (const [key, value] of Object.entries(updates)) {
      if (key === 'id') continue;
      if (value === undefined) continue;
      const attrName = `#${key}`;
      const attrValue = `:${key}`;
      expressionParts.push(`${attrName} = ${attrValue}`);
      expressionNames[attrName] = key;
      expressionValues[attrValue] = value;
    }

    const result = await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: ROLES_TABLE,
        Key: { PK: `ROLE#${id}`, SK: 'METADATA' },
        UpdateExpression: `SET ${expressionParts.join(', ')}`,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: expressionValues,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );

    return this.toRole(result.Attributes!);
  }

  async delete(id: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: ROLES_TABLE,
        Key: { PK: `ROLE#${id}`, SK: 'METADATA' },
      }),
    );
  }

  private toRole(item: Record<string, unknown>): Role {
    return {
      id: item.id as string,
      name: item.name as string,
      description: item.description as string | undefined,
      permissions: item.permissions as Role['permissions'],
      dataScope: item.dataScope as Role['dataScope'],
      dealStageTransitions: item.dealStageTransitions as string[],
      isSystem: item.isSystem as boolean,
      priority: item.priority as number,
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    };
  }
}
