import { Injectable } from '@nestjs/common';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type CommissionConfig } from '@bitcrm/types';
import {
  TECHNICIANS_TABLE,
  COMMISSION_SK_PREFIX,
} from '../constants/dynamo.constants';

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
    return (result.Items || []).map(this.toConfig);
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
    };
  }
}
