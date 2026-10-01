import { Injectable, Logger } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type ClientTag } from '@bitcrm/types';
import { DEALS_TABLE, DEALS_GSI1_NAME } from '../common/constants/dynamo.constants';
import {
  CLIENT_TAG_PK_PREFIX,
  CLIENT_TAG_SK,
  CLIENT_TAG_GSI1PK,
} from './client-tags.constants';

/**
 * Job-tag catalog rows in the single BitCRM_Deals table:
 *   PK = CLIENT_TAG#<id>, SK = METADATA
 *   GSI1PK = CATALOG#CLIENT_TAG, GSI1SK = <priority>#<name>  (list index)
 *
 * Reuses the existing GSI1 exactly as the service-area catalog does — no new
 * index, no schema migration.
 */
@Injectable()
export class ClientTagsRepository {
  private readonly logger = new Logger(ClientTagsRepository.name);

  constructor(private readonly dynamoDb: DynamoDbService) {}

  private item(clientTag: ClientTag): Record<string, unknown> {
    return {
      PK: `${CLIENT_TAG_PK_PREFIX}${clientTag.id}`,
      SK: CLIENT_TAG_SK,
      GSI1PK: CLIENT_TAG_GSI1PK,
      GSI1SK: `${String(clientTag.priority).padStart(6, '0')}#${clientTag.name.toLowerCase()}`,
      ...clientTag,
    };
  }

  /** Insert a new client tag; fails if the id already exists. */
  async create(clientTag: ClientTag): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: DEALS_TABLE,
        Item: this.item(clientTag),
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    this.logger.log(`Created client tag ${clientTag.id} (${clientTag.name})`);
  }

  /** Full replace of an existing client tag (used by the update path). */
  async put(clientTag: ClientTag): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({ TableName: DEALS_TABLE, Item: this.item(clientTag) }),
    );
  }

  async get(id: string): Promise<ClientTag | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: DEALS_TABLE,
        Key: { PK: `${CLIENT_TAG_PK_PREFIX}${id}`, SK: CLIENT_TAG_SK },
      }),
    );
    return result.Item ? this.toEntity(result.Item) : null;
  }

  async listAll(): Promise<ClientTag[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: DEALS_TABLE,
        IndexName: DEALS_GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': CLIENT_TAG_GSI1PK },
      }),
    );
    return (result.Items || []).map((i) => this.toEntity(i));
  }


  async remove(id: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: DEALS_TABLE,
        Key: { PK: `${CLIENT_TAG_PK_PREFIX}${id}`, SK: CLIENT_TAG_SK },
      }),
    );
    this.logger.log(`Deleted client tag ${id}`);
  }

  private toEntity(item: Record<string, unknown>): ClientTag {
    return {
      id: item.id as string,
      name: item.name as string,
      color: (item.color as ClientTag['color']) ?? 'slate',
      priority: (item.priority as number) ?? 0,
      active: Boolean(item.active),
      createdBy: item.createdBy as string,
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    };
  }
}
