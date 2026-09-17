import { Injectable } from '@nestjs/common';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type TechnicianLocationPoint } from '@bitcrm/types';
import {
  TECHNICIANS_TABLE,
  TRACK_TTL_ATTRIBUTE,
  TRACK_TTL_DAYS,
  trackPk,
} from '../constants/dynamo.constants';
import { toRangeEnd, toRangeStart } from '../date-range.util';

const SECONDS_PER_DAY = 86_400;

@Injectable()
export class TechnicianLocationRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  /**
   * Append one breadcrumb.
   *
   * The sort key is the instant alone: the sampler never keeps two points in
   * the same millisecond, and if a retry somehow did, overwriting one position
   * with the identical position is not a loss worth a uuid in every key.
   */
  async append(point: TechnicianLocationPoint): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: TECHNICIANS_TABLE,
        Item: {
          PK: trackPk(point.userId),
          SK: point.recordedAt,
          ...point,
          [TRACK_TTL_ATTRIBUTE]: expiryEpoch(point.recordedAt),
        },
      }),
    );
  }

  /** One technician's trail over [from, to], oldest first. */
  async listInRange(
    userId: string,
    from: string,
    to: string,
  ): Promise<TechnicianLocationPoint[]> {
    const items: Record<string, unknown>[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const result = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: TECHNICIANS_TABLE,
          KeyConditionExpression: 'PK = :pk AND SK BETWEEN :lo AND :hi',
          ExpressionAttributeValues: {
            ':pk': trackPk(userId),
            ':lo': toRangeStart(from),
            ':hi': toRangeEnd(to),
          },
          ExclusiveStartKey: cursor,
        }),
      );
      items.push(...(result.Items || []));
      cursor = result.LastEvaluatedKey;
    } while (cursor);

    // DynamoDB deletes expired items within ~48h of their TTL, and TTL is not
    // enabled on this table yet. Filtering here makes the 30-day bound a
    // promise the API keeps either way.
    const nowEpoch = Math.floor(Date.now() / 1000);
    return items
      .filter((i) => {
        const expiresAt = i[TRACK_TTL_ATTRIBUTE] as number | undefined;
        return expiresAt === undefined || expiresAt > nowEpoch;
      })
      .map(toPoint);
  }
}

function expiryEpoch(recordedAt: string): number {
  return Math.floor(Date.parse(recordedAt) / 1000) + TRACK_TTL_DAYS * SECONDS_PER_DAY;
}

function toPoint(item: Record<string, unknown>): TechnicianLocationPoint {
  return {
    userId: item.userId as string,
    recordedAt: item.recordedAt as string,
    lat: item.lat as number,
    lng: item.lng as number,
    accuracy: item.accuracy as number | undefined,
    timeClockEntryId: item.timeClockEntryId as string | undefined,
  };
}
