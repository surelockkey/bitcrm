import { Injectable } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type Transfer } from '@bitcrm/types';
import {
  INVENTORY_TABLE,
  GSI4_NAME,
} from '../common/constants/dynamo.constants';

export interface PaginatedResult {
  items: Transfer[];
  nextCursor?: string;
}

@Injectable()
export class TransfersRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async create(transfer: Transfer): Promise<void> {
    // Convert to plain object to avoid DynamoDB marshalling issues with class instances
    const plainTransfer = JSON.parse(JSON.stringify(transfer));

    // Main transfer record
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: INVENTORY_TABLE,
        Item: {
          PK: `TRANSFER#${transfer.id}`,
          SK: 'METADATA',
          // GSI4 for source entity lookup
          ...(transfer.fromId && {
            GSI4PK: `ENTITY#${transfer.fromType}#${transfer.fromId}`,
            GSI4SK: `TRANSFER#${transfer.createdAt}#${transfer.id}`,
          }),
          ...plainTransfer,
        },
      }),
    );

    // If there's a destination, create a second record for destination lookup
    if (transfer.toId && transfer.fromId) {
      await this.dynamoDb.client.send(
        new PutCommand({
          TableName: INVENTORY_TABLE,
          Item: {
            PK: `TRANSFER#${transfer.id}`,
            SK: `ENTITY_REF#${transfer.toType}#${transfer.toId}`,
            GSI4PK: `ENTITY#${transfer.toType}#${transfer.toId}`,
            GSI4SK: `TRANSFER#${transfer.createdAt}#${transfer.id}`,
            transferId: transfer.id,
          },
        }),
      );
    } else if (transfer.toId && !transfer.fromId) {
      // Receive: only destination, write GSI4 on main record
      await this.dynamoDb.client.send(
        new PutCommand({
          TableName: INVENTORY_TABLE,
          Item: {
            PK: `TRANSFER#${transfer.id}`,
            SK: `ENTITY_REF#${transfer.toType}#${transfer.toId}`,
            GSI4PK: `ENTITY#${transfer.toType}#${transfer.toId}`,
            GSI4SK: `TRANSFER#${transfer.createdAt}#${transfer.id}`,
            transferId: transfer.id,
          },
        }),
      );
    }
  }

  async findById(id: string): Promise<Transfer | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `TRANSFER#${id}`, SK: 'METADATA' },
      }),
    );

    if (!result.Item) return null;
    return this.toTransfer(result.Item);
  }

  async findByEntity(
    entityType: string,
    entityId: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedResult> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: INVENTORY_TABLE,
        IndexName: GSI4_NAME,
        KeyConditionExpression: 'GSI4PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `ENTITY#${entityType}#${entityId}`,
        },
        ScanIndexForward: false, // newest first
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    // GSI4 items may be references, need to fetch full transfer records
    const items: Transfer[] = [];
    for (const item of result.Items || []) {
      if (item.type) {
        // Full transfer record
        items.push(this.toTransfer(item));
      } else if (item.transferId) {
        // Reference item, fetch full record
        const transfer = await this.findById(item.transferId as string);
        if (transfer) items.push(transfer);
      }
    }

    return {
      items,
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  async findAll(limit: number, cursor?: string): Promise<PaginatedResult> {
    const result = await this.dynamoDb.client.send(
      new ScanCommand({
        TableName: INVENTORY_TABLE,
        FilterExpression: 'begins_with(PK, :pk) AND SK = :sk',
        ExpressionAttributeValues: { ':pk': 'TRANSFER#', ':sk': 'METADATA' },
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    return {
      items: (result.Items || []).map(this.toTransfer),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  private toTransfer(item: Record<string, unknown>): Transfer {
    return {
      id: item.id as string,
      type: item.type as Transfer['type'],
      fromType: (item.fromType as Transfer['fromType']) || null,
      fromId: (item.fromId as string) || null,
      toType: (item.toType as Transfer['toType']) || null,
      toId: (item.toId as string) || null,
      items: (item.items as Transfer['items']) || [],
      performedBy: item.performedBy as string,
      performedByName: item.performedByName as string,
      notes: item.notes as string | undefined,
      createdAt: item.createdAt as string,
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
