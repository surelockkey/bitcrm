import { Injectable, Logger } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type CustomFieldDefinition } from '@bitcrm/types';
import { DEALS_TABLE, DEALS_GSI1_NAME } from '../common/constants/dynamo.constants';
import {
  CUSTOM_FIELD_PK_PREFIX,
  CUSTOM_FIELD_SK,
  CUSTOM_FIELD_GSI1PK,
} from './custom-fields.constants';

/**
 * Custom-field catalog rows in the single BitCRM_Deals table:
 *   PK = CUSTOM_FIELD#<id>, SK = METADATA
 *   GSI1PK = CATALOG#CUSTOM_FIELD, GSI1SK = <priority>#<name>  (list index)
 *
 * Reuses the existing GSI1 exactly as the job-type catalog does — no new
 * index, no schema migration.
 */
@Injectable()
export class CustomFieldsRepository {
  private readonly logger = new Logger(CustomFieldsRepository.name);

  constructor(private readonly dynamoDb: DynamoDbService) {}

  private item(field: CustomFieldDefinition): Record<string, unknown> {
    return {
      PK: `${CUSTOM_FIELD_PK_PREFIX}${field.id}`,
      SK: CUSTOM_FIELD_SK,
      GSI1PK: CUSTOM_FIELD_GSI1PK,
      GSI1SK: `${String(field.priority).padStart(6, '0')}#${field.name.toLowerCase()}`,
      ...field,
    };
  }

  /** Insert a new custom field; fails if the id already exists. */
  async create(field: CustomFieldDefinition): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: DEALS_TABLE,
        Item: this.item(field),
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    this.logger.log(`Created custom field ${field.id} (${field.name})`);
  }

  /** Full replace of an existing custom field (used by the update path). */
  async put(field: CustomFieldDefinition): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({ TableName: DEALS_TABLE, Item: this.item(field) }),
    );
  }

  async get(id: string): Promise<CustomFieldDefinition | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: DEALS_TABLE,
        Key: { PK: `${CUSTOM_FIELD_PK_PREFIX}${id}`, SK: CUSTOM_FIELD_SK },
      }),
    );
    return result.Item ? this.toEntity(result.Item) : null;
  }

  async listAll(): Promise<CustomFieldDefinition[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: DEALS_TABLE,
        IndexName: DEALS_GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': CUSTOM_FIELD_GSI1PK },
      }),
    );
    return (result.Items || []).map((i) => this.toEntity(i));
  }

  /**
   * Whether any deal still stores an answer for this field. Drives
   * archive-vs-delete; a deal keys its answers by field id under the
   * `customFields` map, so the presence of that nested attribute is the
   * reference test. `Limit: 1` because only existence matters, never the count.
   */
  async isReferencedByDeal(id: string): Promise<boolean> {
    const result = await this.dynamoDb.client.send(
      new ScanCommand({
        TableName: DEALS_TABLE,
        FilterExpression: 'attribute_exists(#cf.#fid)',
        ExpressionAttributeNames: { '#cf': 'customFields', '#fid': id },
        Limit: 1,
      }),
    );
    return (result.Items?.length ?? 0) > 0;
  }

  async remove(id: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: DEALS_TABLE,
        Key: { PK: `${CUSTOM_FIELD_PK_PREFIX}${id}`, SK: CUSTOM_FIELD_SK },
      }),
    );
    this.logger.log(`Deleted custom field ${id}`);
  }

  private toEntity(item: Record<string, unknown>): CustomFieldDefinition {
    return {
      id: item.id as string,
      name: item.name as string,
      type: item.type as CustomFieldDefinition['type'],
      group: (item.group as string) ?? '',
      options: (item.options as string[]) ?? [],
      jobTypeIds: (item.jobTypeIds as string[]) ?? [],
      required: Boolean(item.required),
      requiredToClose: Boolean(item.requiredToClose),
      searchable: Boolean(item.searchable),
      priority: (item.priority as number) ?? 0,
      active: Boolean(item.active),
      createdBy: item.createdBy as string,
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    };
  }
}
