import { Injectable } from '@nestjs/common';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type CommissionConfig } from '@bitcrm/types';
import {
  TECHNICIANS_TABLE,
  COMMISSION_SK_PREFIX,
} from '../constants/dynamo.constants';

/** How many technicians' histories are read at once for the commissions report. */
const HISTORY_READ_CONCURRENCY = 10;

/**
 * PK = USER#<userId>, SK = COMMISSION#<effectiveDate> — one row per version,
 * never rewritten: a change writes a new version, so a report can take the
 * rate that was in force on a job's day.
 */
@Injectable()
export class CommissionRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async create(config: CommissionConfig): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: TECHNICIANS_TABLE,
        Item: {
          PK: `USER#${config.userId}`,
          SK: `${COMMISSION_SK_PREFIX}${config.effectiveDate}`,
          ...config,
        },
      }),
    );
  }

  async getLatest(userId: string): Promise<CommissionConfig | null> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: TECHNICIANS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':sk': COMMISSION_SK_PREFIX,
        },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );
    const item = (result.Items || [])[0];
    return item ? this.toConfig(item) : null;
  }

  async listHistory(userId: string): Promise<CommissionConfig[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: TECHNICIANS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':sk': COMMISSION_SK_PREFIX,
        },
        ScanIndexForward: false,
      }),
    );
    return (result.Items || []).map((item) => this.toConfig(item));
  }

  /**
   * Every version of each technician's commission, newest first, keyed by
   * user id (a technician without one maps to `[]`). The commissions report's
   * rate history: a few rows per person, read a handful of people at a time.
   */
  async listHistories(userIds: string[]): Promise<Record<string, CommissionConfig[]>> {
    const unique = [...new Set(userIds.filter(Boolean))];
    const out: Record<string, CommissionConfig[]> = {};
    for (let i = 0; i < unique.length; i += HISTORY_READ_CONCURRENCY) {
      const batch = unique.slice(i, i + HISTORY_READ_CONCURRENCY);
      const histories = await Promise.all(batch.map((id) => this.listHistory(id)));
      batch.forEach((id, n) => (out[id] = histories[n]));
    }
    return out;
  }

  private toConfig(item: Record<string, unknown>): CommissionConfig {
    return {
      userId: item.userId as string,
      baseRatePct: item.baseRatePct as number,
      creditCardFeePct: item.creditCardFeePct as number,
      achFeePct: item.achFeePct as number,
      effectiveDate: item.effectiveDate as string,
      createdBy: item.createdBy as string,
      createdAt: item.createdAt as string,
      // Workiz's fees and rate rules — on imported versions only.
      ...(typeof item.checkFeePct === 'number' && { checkFeePct: item.checkFeePct }),
      ...(typeof item.cashFeePct === 'number' && { cashFeePct: item.cashFeePct }),
      ...(item.additionalFee != null && { additionalFee: item.additionalFee as CommissionConfig['additionalFee'] }),
      ...((item.baseRateUnit === '%' || item.baseRateUnit === '$') && { baseRateUnit: item.baseRateUnit }),
      ...(Array.isArray(item.jobTypeRules) && { jobTypeRules: item.jobTypeRules as CommissionConfig['jobTypeRules'] }),
    };
  }
}
