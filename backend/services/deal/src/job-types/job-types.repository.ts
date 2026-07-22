import { Injectable, Logger } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type JobType } from '@bitcrm/types';
import { DEALS_TABLE, DEALS_GSI1_NAME } from '../common/constants/dynamo.constants';
import {
  JOB_TYPE_PK_PREFIX,
  JOB_TYPE_SK,
  JOB_TYPE_GSI1PK,
} from './job-types.constants';

/**
 * Job-type catalog rows in the single BitCRM_Deals table:
 *   PK = JOB_TYPE#<id>, SK = METADATA
 *   GSI1PK = CATALOG#JOB_TYPE, GSI1SK = <priority>#<name>  (list index)
 *
 * Reuses the existing GSI1 exactly as the service-area catalog does — no new
 * index, no schema migration.
 */
@Injectable()
export class JobTypesRepository {
  private readonly logger = new Logger(JobTypesRepository.name);

  constructor(private readonly dynamoDb: DynamoDbService) {}

  private item(jobType: JobType): Record<string, unknown> {
    return {
      PK: `${JOB_TYPE_PK_PREFIX}${jobType.id}`,
      SK: JOB_TYPE_SK,
      GSI1PK: JOB_TYPE_GSI1PK,
      GSI1SK: `${String(jobType.priority).padStart(6, '0')}#${jobType.name.toLowerCase()}`,
      ...jobType,
    };
  }

  /** Insert a new job type; fails if the id already exists. */
  async create(jobType: JobType): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: DEALS_TABLE,
        Item: this.item(jobType),
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    this.logger.log(`Created job type ${jobType.id} (${jobType.name})`);
  }

  /** Full replace of an existing job type (used by the update path). */
  async put(jobType: JobType): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({ TableName: DEALS_TABLE, Item: this.item(jobType) }),
    );
  }

  async get(id: string): Promise<JobType | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: DEALS_TABLE,
        Key: { PK: `${JOB_TYPE_PK_PREFIX}${id}`, SK: JOB_TYPE_SK },
      }),
    );
    return result.Item ? this.toEntity(result.Item) : null;
  }

  async listAll(): Promise<JobType[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: DEALS_TABLE,
        IndexName: DEALS_GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': JOB_TYPE_GSI1PK },
      }),
    );
    return (result.Items || []).map((i) => this.toEntity(i));
  }

  /**
   * Whether any deal still points at this job type. Drives archive-vs-delete;
   * `Limit: 1` because only existence matters, never the count.
   */
  async isReferencedByDeal(id: string): Promise<boolean> {
    const result = await this.dynamoDb.client.send(
      new ScanCommand({
        TableName: DEALS_TABLE,
        FilterExpression: '#jobTypeId = :id',
        ExpressionAttributeNames: { '#jobTypeId': 'jobTypeId' },
        ExpressionAttributeValues: { ':id': id },
        Limit: 1,
      }),
    );
    return (result.Items?.length ?? 0) > 0;
  }

  async remove(id: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: DEALS_TABLE,
        Key: { PK: `${JOB_TYPE_PK_PREFIX}${id}`, SK: JOB_TYPE_SK },
      }),
    );
    this.logger.log(`Deleted job type ${id}`);
  }

  private toEntity(item: Record<string, unknown>): JobType {
    return {
      id: item.id as string,
      name: item.name as string,
      priority: (item.priority as number) ?? 0,
      active: Boolean(item.active),
      createdBy: item.createdBy as string,
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    };
  }
}
