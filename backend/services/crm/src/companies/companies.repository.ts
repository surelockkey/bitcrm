import { Injectable } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { CrmStatus, type Company } from '@bitcrm/types';
import {
  COMPANIES_TABLE,
  COMPANIES_GSI1_NAME,
} from '../common/constants/dynamo.constants';

export interface PaginatedResult {
  items: Company[];
  nextCursor?: string;
}

@Injectable()
export class CompaniesRepository {
  private tableName = COMPANIES_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  async create(company: Company): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `COMPANY#${company.id}`,
          SK: 'METADATA',
          GSI1PK: `TYPE#${company.clientType}`,
          GSI1SK: `COMPANY#${company.id}`,
          ...company,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }

  async findById(id: string): Promise<Company | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `COMPANY#${id}`, SK: 'METADATA' },
      }),
    );

    if (!result.Item) return null;
    return this.toCompany(result.Item);
  }

  async findByClientType(
    clientType: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedResult> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: COMPANIES_GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        FilterExpression: '#status = :active',
        ExpressionAttributeValues: {
          ':pk': `TYPE#${clientType}`,
          ':active': CrmStatus.ACTIVE,
        },
        ExpressionAttributeNames: { '#status': 'status' },
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    return {
      items: (result.Items || []).map(this.toCompany),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  async findAll(
    limit: number,
    cursor?: string,
  ): Promise<PaginatedResult> {
    const result = await this.dynamoDb.client.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: 'begins_with(PK, :pk) AND SK = :sk AND #status = :status',
        ExpressionAttributeValues: {
          ':pk': 'COMPANY#',
          ':sk': 'METADATA',
          ':status': CrmStatus.ACTIVE,
        },
        ExpressionAttributeNames: { '#status': 'status' },
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    return {
      items: (result.Items || []).map(this.toCompany),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  async update(id: string, attrs: Partial<Company>): Promise<Company> {
    const setParts: string[] = [];
    const expressionNames: Record<string, string> = {};
    const expressionValues: Record<string, unknown> = {};

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { ...attrs, updatedAt: now };

    if (attrs.clientType) {
      updates['GSI1PK'] = `TYPE#${attrs.clientType}`;
      updates['GSI1SK'] = `COMPANY#${id}`;
    }

    const immutableKeys = new Set(['id', 'createdBy', 'createdAt']);
    for (const [key, value] of Object.entries(updates)) {
      if (immutableKeys.has(key)) continue;
      if (value === undefined) continue;
      const attrName = `#${key}`;
      const attrValue = `:${key}`;
      expressionNames[attrName] = key;
      expressionValues[attrValue] = value;
      setParts.push(`${attrName} = ${attrValue}`);
    }

    const result = await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `COMPANY#${id}`, SK: 'METADATA' },
        UpdateExpression: `SET ${setParts.join(', ')}`,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: expressionValues,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );

    return this.toCompany(result.Attributes!);
  }

  private toCompany(item: Record<string, unknown>): Company {
    return {
      id: item.id as string,
      title: item.title as string,
      phones: (item.phones as string[]) || [],
      emails: (item.emails as string[]) || [],
      address: item.address as string | undefined,
      website: item.website as string | undefined,
      clientType: item.clientType as Company['clientType'],
      notes: item.notes as string | undefined,
      status: item.status as Company['status'],
      createdBy: item.createdBy as string,
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
