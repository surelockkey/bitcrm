import { Injectable } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type TechnicianProfile, type TechnicianProfileStatus } from '@bitcrm/types';
import {
  TECHNICIANS_TABLE,
  GSI3_NAME,
  TECHNICIAN_GSI_PK,
  PROFILE_SK,
} from './constants/dynamo.constants';

interface PaginatedResult {
  items: TechnicianProfile[];
  nextCursor?: string;
}

@Injectable()
export class TechniciansRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async upsertProfile(profile: TechnicianProfile): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: TECHNICIANS_TABLE,
        Item: {
          PK: `USER#${profile.userId}`,
          SK: PROFILE_SK,
          GSI3PK: TECHNICIAN_GSI_PK,
          GSI3SK: `${profile.status}#${profile.userId}`,
          ...profile,
        },
      }),
    );
  }

  async getProfile(userId: string): Promise<TechnicianProfile | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: TECHNICIANS_TABLE,
        Key: { PK: `USER#${userId}`, SK: PROFILE_SK },
      }),
    );
    if (!result.Item) return null;
    return this.toProfile(result.Item);
  }

  async updateProfile(
    userId: string,
    attrs: Partial<TechnicianProfile>,
  ): Promise<TechnicianProfile> {
    const setParts: string[] = [];
    const removeParts: string[] = [];
    const expressionNames: Record<string, string> = {};
    const expressionValues: Record<string, unknown> = {};

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { ...attrs, updatedAt: now };

    // Rebuild the GSI sort key only when status changes (keeps the list index correct).
    if (attrs.status) {
      updates.GSI3SK = `${attrs.status}#${userId}`;
    }

    const immutableKeys = new Set(['userId', 'createdAt']);
    for (const [key, value] of Object.entries(updates)) {
      if (immutableKeys.has(key)) continue;
      const attrName = `#${key}`;
      expressionNames[attrName] = key;
      if (value === undefined) {
        if (key in attrs) removeParts.push(attrName);
      } else {
        const attrValue = `:${key}`;
        setParts.push(`${attrName} = ${attrValue}`);
        expressionValues[attrValue] = value;
      }
    }

    const segments: string[] = [];
    if (setParts.length > 0) segments.push(`SET ${setParts.join(', ')}`);
    if (removeParts.length > 0) segments.push(`REMOVE ${removeParts.join(', ')}`);

    const result = await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: TECHNICIANS_TABLE,
        Key: { PK: `USER#${userId}`, SK: PROFILE_SK },
        UpdateExpression: segments.join(' '),
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues:
          Object.keys(expressionValues).length > 0 ? expressionValues : undefined,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );

    return this.toProfile(result.Attributes!);
  }

  async listAll(limit: number, cursor?: string): Promise<PaginatedResult> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: TECHNICIANS_TABLE,
        IndexName: GSI3_NAME,
        KeyConditionExpression: 'GSI3PK = :pk',
        ExpressionAttributeValues: { ':pk': TECHNICIAN_GSI_PK },
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    return {
      items: (result.Items || []).map(this.toProfile),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  async listByStatus(
    status: TechnicianProfileStatus,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedResult> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: TECHNICIANS_TABLE,
        IndexName: GSI3_NAME,
        KeyConditionExpression: 'GSI3PK = :pk AND begins_with(GSI3SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': TECHNICIAN_GSI_PK,
          ':sk': `${status}#`,
        },
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    return {
      items: (result.Items || []).map(this.toProfile),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  private toProfile(item: Record<string, unknown>): TechnicianProfile {
    return {
      userId: item.userId as string,
      phone: item.phone as string | undefined,
      homeAddress: item.homeAddress as TechnicianProfile['homeAddress'],
      profilePhotoUrl: item.profilePhotoUrl as string | undefined,
      laborCostPerHour: item.laborCostPerHour as number | undefined,
      callMaskingEnabled: Boolean(item.callMaskingEnabled),
      gpsTrackingEnabled: Boolean(item.gpsTrackingEnabled),
      mobileAppInstalled: Boolean(item.mobileAppInstalled),
      status: item.status as TechnicianProfileStatus,
      workingDays: item.workingDays as number[] | undefined,
      workStart: item.workStart as string | undefined,
      workEnd: item.workEnd as string | undefined,
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

  private decodeCursor(cursor?: string): Record<string, unknown> | undefined {
    if (!cursor) return undefined;
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
  }
}
