import { Injectable, Optional } from '@nestjs/common';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { AccountClock, type TimelineEntry } from '@bitcrm/types';
import { DEALS_TABLE } from '../common/constants/dynamo.constants';
import { activityIndexFields } from '../activity/activity-index';
import { currentActivitySource } from '../activity/activity-source';
import { ActivityCountsRepository } from '../activity/activity-counts.repository';

export interface PaginatedTimelineResult {
  items: TimelineEntry[];
  nextCursor?: string;
}

/** The account's calendar: an event's Activity day is its New York day. */
const clock = new AccountClock();

/**
 * A job's events: `DEAL#<dealId>` / `TIMELINE#<timestamp>#<id>`.
 *
 * Every event is also an Activity report row: the write adds the sparse keys
 * of the report's two indexes (GSI8 ActivityDayIndex by account day, GSI9
 * ActorIndex by who did it — `activity/activity.constants.ts`), the search
 * text and where it was done (web / mobile, from the request), and ticks the
 * day's counter. Rows written before that get the keys from
 * `backfill:activity-index`.
 */
@Injectable()
export class TimelineRepository {
  private tableName = DEALS_TABLE;

  constructor(
    private readonly dynamoDb: DynamoDbService,
    @Optional() private readonly activityCounts?: ActivityCountsRepository,
  ) {}

  async addEntry(entry: TimelineEntry): Promise<void> {
    const item: Record<string, unknown> = {
      PK: `DEAL#${entry.dealId}`,
      SK: `TIMELINE#${entry.timestamp}#${entry.id}`,
      ...entry,
    };
    const activity = activityIndexFields(item, clock, currentActivitySource());
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { ...item, ...activity },
      }),
    );
    if (activity && this.activityCounts) {
      await this.activityCounts.add(activity.GSI8PK.slice('ACTDAY#'.length), 1);
    }
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
    const res = await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: this.key(dealId, timestamp, id),
        ReturnValues: 'ALL_OLD',
      }),
    );
    // Only an event that was counted is uncounted.
    const day = res?.Attributes?.GSI8PK;
    if (typeof day === 'string' && this.activityCounts) {
      await this.activityCounts.add(day.slice('ACTDAY#'.length), -1);
    }
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
