import { Injectable, Logger } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type JobSource } from '@bitcrm/types';
import { DEALS_TABLE, DEALS_GSI1_NAME } from '../common/constants/dynamo.constants';
import {
  JOB_SOURCE_PK_PREFIX,
  JOB_SOURCE_SK,
  JOB_SOURCE_GSI1PK,
} from './job-sources.constants';

/**
 * Job-type catalog rows in the single BitCRM_Deals table:
 *   PK = JOB_SOURCE#<id>, SK = METADATA
 *   GSI1PK = CATALOG#JOB_SOURCE, GSI1SK = <priority>#<name>  (list index)
 *
 * Reuses the existing GSI1 exactly as the service-area catalog does — no new
 * index, no schema migration.
 */
@Injectable()
export class JobSourcesRepository {
  private readonly logger = new Logger(JobSourcesRepository.name);

  constructor(private readonly dynamoDb: DynamoDbService) {}

  private item(jobSource: JobSource): Record<string, unknown> {
    return {
      PK: `${JOB_SOURCE_PK_PREFIX}${jobSource.id}`,
      SK: JOB_SOURCE_SK,
      GSI1PK: JOB_SOURCE_GSI1PK,
      GSI1SK: `${String(jobSource.priority).padStart(6, '0')}#${jobSource.name.toLowerCase()}`,
      ...jobSource,
    };
  }

  /** Insert a new job source; fails if the id already exists. */
  async create(jobSource: JobSource): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: DEALS_TABLE,
        Item: this.item(jobSource),
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    this.logger.log(`Created job source ${jobSource.id} (${jobSource.name})`);
  }

  /** Full replace of an existing job source (used by the update path). */
  async put(jobSource: JobSource): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({ TableName: DEALS_TABLE, Item: this.item(jobSource) }),
    );
  }

  async get(id: string): Promise<JobSource | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: DEALS_TABLE,
        Key: { PK: `${JOB_SOURCE_PK_PREFIX}${id}`, SK: JOB_SOURCE_SK },
      }),
    );
    return result.Item ? this.toEntity(result.Item) : null;
  }

  async listAll(): Promise<JobSource[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: DEALS_TABLE,
        IndexName: DEALS_GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': JOB_SOURCE_GSI1PK },
      }),
    );
    return (result.Items || []).map((i) => this.toEntity(i));
  }

  /**
   * Whether any deal still points at this job source. Drives archive-vs-delete;
   * `Limit: 1` because only existence matters, never the count.
   */
  async isReferencedByDeal(id: string): Promise<boolean> {
    const result = await this.dynamoDb.client.send(
      new ScanCommand({
        TableName: DEALS_TABLE,
        FilterExpression: '#sourceId = :id',
        ExpressionAttributeNames: { '#sourceId': 'sourceId' },
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
        Key: { PK: `${JOB_SOURCE_PK_PREFIX}${id}`, SK: JOB_SOURCE_SK },
      }),
    );
    this.logger.log(`Deleted job source ${id}`);
  }

  private toEntity(item: Record<string, unknown>): JobSource {
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
