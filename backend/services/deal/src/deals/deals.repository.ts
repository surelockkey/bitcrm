import { Injectable, Logger } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { DealStatus, type Deal } from '@bitcrm/types';
import {
  DEALS_TABLE,
  DEALS_GSI1_NAME,
  DEALS_GSI2_NAME,
  DEALS_GSI3_NAME,
  DEALS_GSI4_NAME,
} from '../common/constants/dynamo.constants';

export interface PaginatedResult {
  items: Deal[];
  nextCursor?: string;
}

@Injectable()
export class DealsRepository {
  private readonly logger = new Logger(DealsRepository.name);
  private tableName = DEALS_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  async create(deal: Deal): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `DEAL#${deal.id}`,
          SK: 'METADATA',
          GSI1PK: `STAGE#${deal.stage}`,
          GSI1SK: `${deal.createdAt}#DEAL#${deal.id}`,
          GSI2PK: `TECH#${deal.assignedTechId || 'UNASSIGNED'}`,
          GSI2SK: `${deal.scheduledDate || deal.createdAt}#DEAL#${deal.id}`,
          GSI3PK: `CONTACT#${deal.contactId}`,
          GSI3SK: `${deal.createdAt}#DEAL#${deal.id}`,
          GSI4PK: `DISPATCHER#${deal.assignedDispatcherId}`,
          GSI4SK: `${deal.createdAt}#DEAL#${deal.id}`,
          ...deal,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }

  async findById(id: string): Promise<Deal | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `DEAL#${id}`, SK: 'METADATA' },
      }),
    );

    if (!result.Item) return null;
    return this.toDeal(result.Item);
  }

  async findByStage(
    stage: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedResult> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: DEALS_GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        FilterExpression: '#status = :active',
        ExpressionAttributeValues: {
          ':pk': `STAGE#${stage}`,
          ':active': DealStatus.ACTIVE,
        },
        ExpressionAttributeNames: { '#status': 'status' },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    return {
      items: (result.Items || []).map((i) => this.toDeal(i)),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  async findByTech(
    techId: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedResult> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: DEALS_GSI2_NAME,
        KeyConditionExpression: 'GSI2PK = :pk',
        FilterExpression: '#status = :active',
        ExpressionAttributeValues: {
          ':pk': `TECH#${techId}`,
          ':active': DealStatus.ACTIVE,
        },
        ExpressionAttributeNames: { '#status': 'status' },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    return {
      items: (result.Items || []).map((i) => this.toDeal(i)),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  async findByContact(
    contactId: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedResult> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: DEALS_GSI3_NAME,
        KeyConditionExpression: 'GSI3PK = :pk',
        FilterExpression: '#status = :active',
        ExpressionAttributeValues: {
          ':pk': `CONTACT#${contactId}`,
          ':active': DealStatus.ACTIVE,
        },
        ExpressionAttributeNames: { '#status': 'status' },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    return {
      items: (result.Items || []).map((i) => this.toDeal(i)),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  async findByDispatcher(
    dispatcherId: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedResult> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: DEALS_GSI4_NAME,
        KeyConditionExpression: 'GSI4PK = :pk',
        FilterExpression: '#status = :active',
        ExpressionAttributeValues: {
          ':pk': `DISPATCHER#${dispatcherId}`,
          ':active': DealStatus.ACTIVE,
        },
        ExpressionAttributeNames: { '#status': 'status' },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    return {
      items: (result.Items || []).map((i) => this.toDeal(i)),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  async findAll(
    limit: number,
    cursor?: string,
    filters?: { status?: string },
  ): Promise<PaginatedResult> {
    const statusFilter = filters?.status || DealStatus.ACTIVE;

    const result = await this.dynamoDb.client.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression:
          'begins_with(PK, :pk) AND SK = :sk AND #status = :status',
        ExpressionAttributeValues: {
          ':pk': 'DEAL#',
          ':sk': 'METADATA',
          ':status': statusFilter,
        },
        ExpressionAttributeNames: { '#status': 'status' },
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    return {
      items: (result.Items || []).map((i) => this.toDeal(i)),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  async update(id: string, attrs: Partial<Deal>): Promise<Deal> {
    const setParts: string[] = [];
    const expressionNames: Record<string, string> = {};
    const expressionValues: Record<string, unknown> = {};

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { ...attrs, updatedAt: now };

    // Update GSI keys when relevant fields change
    if (attrs.stage !== undefined) {
      updates['GSI1PK'] = `STAGE#${attrs.stage}`;
    }
    if (attrs.assignedTechId !== undefined) {
      updates['GSI2PK'] = `TECH#${attrs.assignedTechId || 'UNASSIGNED'}`;
    }
    if (attrs.scheduledDate !== undefined) {
      // GSI2SK needs deal id which we rebuild
      updates['GSI2SK'] = `${attrs.scheduledDate}#DEAL#${id}`;
    }

    const immutableKeys = new Set([
      'id', 'dealNumber', 'contactId', 'createdBy', 'createdAt',
    ]);

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
        Key: { PK: `DEAL#${id}`, SK: 'METADATA' },
        UpdateExpression: `SET ${setParts.join(', ')}`,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: expressionValues,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );

    return this.toDeal(result.Attributes!);
  }

  async softDelete(id: string): Promise<void> {
    await this.update(id, { status: DealStatus.DELETED } as any);
  }

  async getNextDealNumber(): Promise<number> {
    const result = await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: 'COUNTER', SK: 'DEAL_NUMBER' },
        UpdateExpression: 'ADD dealNumber :inc',
        ExpressionAttributeValues: { ':inc': 1 },
        ReturnValues: 'ALL_NEW',
      }),
    );

    return result.Attributes!.dealNumber as number;
  }

  private toDeal(item: Record<string, unknown>): Deal {
    return {
      id: item.id as string,
      dealNumber: item.dealNumber as number,
      contactId: item.contactId as string,
      companyId: item.companyId as string | undefined,
      clientType: item.clientType as Deal['clientType'],
      scheduledDate: item.scheduledDate as string | undefined,
      scheduledTimeSlot: item.scheduledTimeSlot as string | undefined,
      serviceArea: item.serviceArea as string,
      address: item.address as Deal['address'],
      jobType: item.jobType as string,
      stage: item.stage as Deal['stage'],
      assignedTechId: item.assignedTechId as string | undefined,
      assignedDispatcherId: item.assignedDispatcherId as string,
      sequenceNumber: item.sequenceNumber as number | undefined,
      priority: item.priority as Deal['priority'],
      source: item.source as string | undefined,
      notes: item.notes as string | undefined,
      internalNotes: item.internalNotes as string | undefined,
      cancellationReason: item.cancellationReason as string | undefined,
      tags: (item.tags as string[]) || [],
      estimatedTotal: item.estimatedTotal as number | undefined,
      actualTotal: item.actualTotal as number | undefined,
      paymentStatus: item.paymentStatus as string | undefined,
      status: item.status as Deal['status'],
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
