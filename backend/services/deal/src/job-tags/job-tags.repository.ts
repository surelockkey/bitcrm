import { Injectable, Logger } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type JobTag } from '@bitcrm/types';
import { DEALS_TABLE, DEALS_GSI1_NAME } from '../common/constants/dynamo.constants';
import {
  JOB_TAG_PK_PREFIX,
  JOB_TAG_SK,
  JOB_TAG_GSI1PK,
} from './job-tags.constants';

/**
 * Job-tag catalog rows in the single BitCRM_Deals table:
 *   PK = JOB_TAG#<id>, SK = METADATA
 *   GSI1PK = CATALOG#JOB_TAG, GSI1SK = <priority>#<name>  (list index)
 *
 * Reuses the existing GSI1 exactly as the service-area catalog does — no new
 * index, no schema migration.
 */
@Injectable()
export class JobTagsRepository {
  private readonly logger = new Logger(JobTagsRepository.name);

  constructor(private readonly dynamoDb: DynamoDbService) {}

  private item(jobTag: JobTag): Record<string, unknown> {
    return {
      PK: `${JOB_TAG_PK_PREFIX}${jobTag.id}`,
      SK: JOB_TAG_SK,
      GSI1PK: JOB_TAG_GSI1PK,
      GSI1SK: `${String(jobTag.priority).padStart(6, '0')}#${jobTag.name.toLowerCase()}`,
      ...jobTag,
    };
  }

  /** Insert a new job tag; fails if the id already exists. */
  async create(jobTag: JobTag): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: DEALS_TABLE,
        Item: this.item(jobTag),
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    this.logger.log(`Created job tag ${jobTag.id} (${jobTag.name})`);
  }

  /** Full replace of an existing job tag (used by the update path). */
  async put(jobTag: JobTag): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({ TableName: DEALS_TABLE, Item: this.item(jobTag) }),
    );
  }

  async get(id: string): Promise<JobTag | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: DEALS_TABLE,
        Key: { PK: `${JOB_TAG_PK_PREFIX}${id}`, SK: JOB_TAG_SK },
      }),
    );
    return result.Item ? this.toEntity(result.Item) : null;
  }

  async listAll(): Promise<JobTag[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: DEALS_TABLE,
        IndexName: DEALS_GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': JOB_TAG_GSI1PK },
      }),
    );
    return (result.Items || []).map((i) => this.toEntity(i));
  }

  /**
   * Whether any deal still carries this job tag. Deals store `tagIds` as a list,
   * so membership is a `contains`, not the scalar `=` the source/type repos use.
   * `Limit: 1` because only existence matters, never the count.
   */
  async isReferencedByDeal(id: string): Promise<boolean> {
    const result = await this.dynamoDb.client.send(
      new ScanCommand({
        TableName: DEALS_TABLE,
        FilterExpression: 'contains(#tagIds, :id)',
        ExpressionAttributeNames: { '#tagIds': 'tagIds' },
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
        Key: { PK: `${JOB_TAG_PK_PREFIX}${id}`, SK: JOB_TAG_SK },
      }),
    );
    this.logger.log(`Deleted job tag ${id}`);
  }

  private toEntity(item: Record<string, unknown>): JobTag {
    return {
      id: item.id as string,
      name: item.name as string,
      color: (item.color as JobTag['color']) ?? 'slate',
      priority: (item.priority as number) ?? 0,
      active: Boolean(item.active),
      createdBy: item.createdBy as string,
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    };
  }
}
