import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { TECHNICIANS_TABLE, auditPk } from '../constants/dynamo.constants';
import { type AuditEntry } from './audit.types';

@Injectable()
export class AuditRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: TECHNICIANS_TABLE,
        Item: {
          PK: auditPk(entry.userId),
          SK: `${entry.timestamp}#${randomUUID()}`,
          ...entry,
        },
      }),
    );
  }

  async listByUser(userId: string, limit = 50): Promise<AuditEntry[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: TECHNICIANS_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': auditPk(userId) },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (result.Items || []).map((i) => ({
      userId: i.userId as string,
      actorId: i.actorId as string,
      action: i.action as string,
      resource: i.resource as string,
      timestamp: i.timestamp as string,
    }));
  }
}
