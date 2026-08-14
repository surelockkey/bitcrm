import { Injectable } from '@nestjs/common';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type TimelineEntry } from '@bitcrm/types';
import { DEALS_TABLE } from '../common/constants/dynamo.constants';

export interface PaginatedTimelineResult {
  items: TimelineEntry[];
  nextCursor?: string;
}

@Injectable()
export class TimelineRepository {
  private tableName = DEALS_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  async addEntry(entry: TimelineEntry): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `DEAL#${entry.dealId}`,
          SK: `TIMELINE#${entry.timestamp}#${entry.id}`,
          ...entry,
        },
      }),
    );
  }

  /** Entries are keyed by timestamp + id, so point reads need both. */
  private key(dealId: string, timestamp: string, id: string) {
    return { PK: `DEAL#${dealId}`, SK: `TIMELINE#${timestamp}#${id}` };
  }

  async getEntry(
    dealId: string,
    timestamp: string,
    id: string,
  ): Promise<TimelineEntry | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({ TableName: this.tableName, Key: this.key(dealId, timestamp, id) }),
    );
    return result.Item ? this.toEntry(result.Item) : null;
  }

  async updateNote(
    dealId: string,
    timestamp: string,
    id: string,
    note: string,
  ): Promise<void> {
    await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: this.key(dealId, timestamp, id),
        UpdateExpression: 'SET #note = :note',
        ExpressionAttributeNames: { '#note': 'note' },
        ExpressionAttributeValues: { ':note': note },
      }),
    );
  }

  async deleteEntry(dealId: string, timestamp: string, id: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({ TableName: this.tableName, Key: this.key(dealId, timestamp, id) }),
    );
  }

  async findByDeal(
    dealId: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedTimelineResult> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `DEAL#${dealId}`,
          ':sk': 'TIMELINE#',
        },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    return {
      items: (result.Items || []).map((i) => this.toEntry(i)),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  private toEntry(item: Record<string, unknown>): TimelineEntry {
    return {
      id: item.id as string,
      dealId: item.dealId as string,
      eventType: item.eventType as TimelineEntry['eventType'],
      actorId: item.actorId as string,
      actorName: item.actorName as string,
      timestamp: item.timestamp as string,
      details: (item.details as Record<string, unknown>) || {},
      note: item.note as string | undefined,
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
