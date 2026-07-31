import { Injectable, Logger } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type DealSubStatus } from '@bitcrm/types';
import { DEALS_TABLE, DEALS_GSI1_NAME } from '../common/constants/dynamo.constants';
import {
  JOB_STATUS_PK_PREFIX,
  JOB_STATUS_SK,
  JOB_STATUS_GSI1PK,
} from './job-statuses.constants';

/**
 * Job-sub-status catalog rows in the single BitCRM_Deals table:
 *   PK = JOB_STATUS#<id>, SK = METADATA
 *   GSI1PK = CATALOG#JOB_STATUS, GSI1SK = <group>#<priority>#<name>  (list index)
 *
 * Reuses the existing GSI1 exactly as the job-tag catalog does — no new index,
 * no schema migration. Rows sort by super-status then priority in the raw index.
 */
@Injectable()
export class JobStatusesRepository {
  private readonly logger = new Logger(JobStatusesRepository.name);

  constructor(private readonly dynamoDb: DynamoDbService) {}

  private item(status: DealSubStatus): Record<string, unknown> {
    return {
      PK: `${JOB_STATUS_PK_PREFIX}${status.id}`,
      SK: JOB_STATUS_SK,
      GSI1PK: JOB_STATUS_GSI1PK,
      GSI1SK: `${status.group}#${String(status.priority).padStart(6, '0')}#${status.name.toLowerCase()}`,
      ...status,
    };
  }

  /** Insert a new sub-status; fails if the id already exists. */
  async create(status: DealSubStatus): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: DEALS_TABLE,
        Item: this.item(status),
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    this.logger.log(`Created job status ${status.id} (${status.name})`);
  }

  /** Full replace of an existing sub-status (used by the update path). */
  async put(status: DealSubStatus): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({ TableName: DEALS_TABLE, Item: this.item(status) }),
    );
  }

  async get(id: string): Promise<DealSubStatus | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: DEALS_TABLE,
        Key: { PK: `${JOB_STATUS_PK_PREFIX}${id}`, SK: JOB_STATUS_SK },
      }),
    );
    return result.Item ? this.toEntity(result.Item) : null;
  }

  async listAll(): Promise<DealSubStatus[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: DEALS_TABLE,
        IndexName: DEALS_GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': JOB_STATUS_GSI1PK },
      }),
    );
    return (result.Items || []).map((i) => this.toEntity(i));
  }

  /**
   * Whether any deal still carries this sub-status. Deals store `subStatusId` as
   * a scalar, so membership is a simple `=` (unlike the tag catalog's list
   * `contains`).
   *
   * Deliberately NOT `Limit: 1`: DynamoDB applies a Scan's Limit *before* the
   * FilterExpression, so `Limit: 1` would only evaluate one arbitrary item and
   * miss a referencing deal that isn't scanned first — wrongly reporting the
   * status as unreferenced and letting `remove` hard-delete it. Instead we
   * page (projecting just the key) and stop at the first match.
   */
  async isReferencedByDeal(id: string): Promise<boolean> {
    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await this.dynamoDb.client.send(
        new ScanCommand({
          TableName: DEALS_TABLE,
          FilterExpression: '#subStatusId = :id',
          ExpressionAttributeNames: { '#subStatusId': 'subStatusId' },
          ExpressionAttributeValues: { ':id': id },
          ProjectionExpression: 'PK',
          ExclusiveStartKey: lastKey,
        }),
      );
      if ((result.Items?.length ?? 0) > 0) return true;
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return false;
  }

  async remove(id: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: DEALS_TABLE,
        Key: { PK: `${JOB_STATUS_PK_PREFIX}${id}`, SK: JOB_STATUS_SK },
      }),
    );
    this.logger.log(`Deleted job status ${id}`);
  }

  private toEntity(item: Record<string, unknown>): DealSubStatus {
    return {
      id: item.id as string,
      name: item.name as string,
      group: item.group as DealSubStatus['group'],
      color: (item.color as DealSubStatus['color']) ?? 'slate',
      priority: (item.priority as number) ?? 0,
      active: Boolean(item.active),
      createdBy: item.createdBy as string,
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    };
  }
}
