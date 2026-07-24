import { Injectable } from '@nestjs/common';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type WorkOrder } from '@bitcrm/types';
import {
  COMPANIES_TABLE,
  COMPANIES_GSI1_NAME,
  WORK_ORDER_GSI_PK,
} from '../common/constants/dynamo.constants';

/**
 * Work orders in the single BitCRM_Companies table:
 *   PK = WORKORDER#<id>, SK = METADATA
 *   GSI1PK = WORKORDER#ALL, GSI1SK = <date>#<id>  (date-sorted registry)
 * Reuses the existing GSI1 (ClientTypeIndex) — no new index.
 */
@Injectable()
export class WorkOrdersRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  private item(wo: WorkOrder): Record<string, unknown> {
    return {
      PK: `WORKORDER#${wo.id}`,
      SK: 'METADATA',
      GSI1PK: WORK_ORDER_GSI_PK,
      GSI1SK: `${wo.date}#${wo.id}`,
      ...wo,
    };
  }

  async create(wo: WorkOrder): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: COMPANIES_TABLE,
        Item: this.item(wo),
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }

  async put(wo: WorkOrder): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({ TableName: COMPANIES_TABLE, Item: this.item(wo) }),
    );
  }

  async get(id: string): Promise<WorkOrder | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({ TableName: COMPANIES_TABLE, Key: { PK: `WORKORDER#${id}`, SK: 'METADATA' } }),
    );
    return result.Item ? this.toEntity(result.Item) : null;
  }

  /** The whole registry, newest first. Company/status filtering happens in the service. */
  async listAll(): Promise<WorkOrder[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: COMPANIES_TABLE,
        IndexName: COMPANIES_GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': WORK_ORDER_GSI_PK },
        ScanIndexForward: false,
      }),
    );
    return (result.Items || []).map((i) => this.toEntity(i));
  }

  async remove(id: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({ TableName: COMPANIES_TABLE, Key: { PK: `WORKORDER#${id}`, SK: 'METADATA' } }),
    );
  }

  private toEntity(item: Record<string, unknown>): WorkOrder {
    return {
      id: item.id as string,
      woNumber: item.woNumber as string,
      companyId: item.companyId as string,
      dealId: item.dealId as string | undefined,
      date: item.date as string,
      amount: item.amount as number | undefined,
      description: item.description as string | undefined,
      s3Key: item.s3Key as string | undefined,
      status: item.status as WorkOrder['status'],
      createdBy: item.createdBy as string,
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    };
  }
}
