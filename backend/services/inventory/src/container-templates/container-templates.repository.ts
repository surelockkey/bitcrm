import { Injectable } from '@nestjs/common';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type ContainerTemplate } from '@bitcrm/types';
import { INVENTORY_TABLE, GSI1_NAME } from '../common/constants/dynamo.constants';
import {
  CONTAINER_TEMPLATE_GSI1PK,
  CONTAINER_TEMPLATE_PK_PREFIX,
  CONTAINER_TEMPLATE_SK,
  containerTemplateSortKey,
} from './container-templates.constants';

/** Key attributes that must never leak into an entity. */
const KEY_ATTRIBUTES = new Set([
  'PK', 'SK', 'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK', 'GSI3PK', 'GSI3SK', 'GSI4PK', 'GSI4SK',
]);

/**
 * Container templates ("ideal loadout" of a van) in the single BitCRM_Inventory
 * table:
 *   PK = CONTAINER_TEMPLATE#<id>, SK = METADATA
 *   GSI1PK = CATALOG#CONTAINER_TEMPLATE, GSI1SK = <name trimmed lowercased>
 *     (the list, name order; `findByName` is an exact key condition on it)
 * `items` is a list attribute on the row. Updates replace the whole row.
 */
@Injectable()
export class ContainerTemplatesRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  private item(template: ContainerTemplate): Record<string, unknown> {
    return {
      ...template,
      PK: `${CONTAINER_TEMPLATE_PK_PREFIX}${template.id}`,
      SK: CONTAINER_TEMPLATE_SK,
      GSI1PK: CONTAINER_TEMPLATE_GSI1PK,
      GSI1SK: containerTemplateSortKey(template.name),
    };
  }

  async create(template: ContainerTemplate): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: INVENTORY_TABLE,
        Item: this.item(template),
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }

  /** Full replace of an existing template — an attribute left off the entity is gone. */
  async put(template: ContainerTemplate): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: INVENTORY_TABLE,
        Item: this.item(template),
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  }

  async findById(id: string): Promise<ContainerTemplate | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `${CONTAINER_TEMPLATE_PK_PREFIX}${id}`, SK: CONTAINER_TEMPLATE_SK },
      }),
    );
    return result.Item ? this.toEntity(result.Item) : null;
  }

  /** Every template, whatever its status, in name order. */
  async listAll(): Promise<ContainerTemplate[]> {
    return this.queryAll('GSI1PK = :pk', { ':pk': CONTAINER_TEMPLATE_GSI1PK });
  }

  /**
   * Every template with this name, case-insensitively, whatever its status —
   * the uniqueness check decides which count. An exact key condition on the
   * sort key, paged to the end: never a filtered Scan with `Limit: 1`, which
   * applies the limit before the filter and reports a taken name as free.
   */
  async findByName(name: string): Promise<ContainerTemplate[]> {
    return this.queryAll('GSI1PK = :pk AND GSI1SK = :name', {
      ':pk': CONTAINER_TEMPLATE_GSI1PK,
      ':name': containerTemplateSortKey(name),
    });
  }

  private async queryAll(
    keyCondition: string,
    values: Record<string, unknown>,
  ): Promise<ContainerTemplate[]> {
    const templates: ContainerTemplate[] = [];
    let key: Record<string, unknown> | undefined;
    do {
      const page = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: INVENTORY_TABLE,
          IndexName: GSI1_NAME,
          KeyConditionExpression: keyCondition,
          ExpressionAttributeValues: values,
          ...(key ? { ExclusiveStartKey: key } : {}),
        }),
      );
      for (const item of page.Items ?? []) templates.push(this.toEntity(item));
      key = page.LastEvaluatedKey;
    } while (key);
    return templates;
  }

  private toEntity(item: Record<string, unknown>): ContainerTemplate {
    const entity: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      if (!KEY_ATTRIBUTES.has(key)) entity[key] = value;
    }
    return { ...entity, items: (item.items as ContainerTemplate['items']) ?? [] } as ContainerTemplate;
  }
}
