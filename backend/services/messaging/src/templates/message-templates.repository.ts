import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type MessageTemplate } from '@bitcrm/types';
import {
  MESSAGING_GSI3_NAME,
  MESSAGING_TABLE,
  METADATA_SK,
  TEMPLATE_CATALOG_GSI3PK,
  templateCatalogSk,
  templatePk,
} from '../common/constants/dynamo.constants';
import { compact, stripKeys } from '../common/items';

/**
 * Message templates (design §3.2, A13):
 *   TEMPLATE#<id> / METADATA
 *   GSI3PK = CATALOG#MESSAGE_TEMPLATE, GSI3SK = <title lower>#<id>
 * A constant catalog partition on the existing CategoryIndex, exactly like
 * `CATALOG#JOB_TAG` in deal — no extra index (CLAUDE.md §5). Tens of rows,
 * alphabetical by title. Referenced templates are archived, never deleted.
 */
@Injectable()
export class MessageTemplatesRepository {
  private readonly logger = new Logger(MessageTemplatesRepository.name);
  private tableName = MESSAGING_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  /** `Put TEMPLATE#<id>` with `attribute_not_exists(PK)`. */
  async create(template: MessageTemplate): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: this.item(template),
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    this.logger.log(`Created message template ${template.id} (${template.messageTemplateTitle})`);
  }

  /** Full replace (the update path); the catalog sort key follows the title. */
  async put(template: MessageTemplate): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({ TableName: this.tableName, Item: this.item(template) }),
    );
  }

  /** `GetItem TEMPLATE#<id>/METADATA`. */
  async get(id: string): Promise<MessageTemplate | null> {
    const res = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: templatePk(id), SK: METADATA_SK },
      }),
    );
    return res.Item ? this.toEntity(res.Item) : null;
  }

  /**
   * `Query CategoryIndex GSI3PK = CATALOG#MESSAGE_TEMPLATE`, alphabetical,
   * every page. Archived rows are dropped in memory (the catalog is tiny) —
   * still no FilterExpression, and no Scan.
   */
  async list(opts: { includeInactive?: boolean } = {}): Promise<MessageTemplate[]> {
    const items: MessageTemplate[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: MESSAGING_GSI3_NAME,
          KeyConditionExpression: 'GSI3PK = :pk',
          ExpressionAttributeValues: { ':pk': TEMPLATE_CATALOG_GSI3PK },
          ScanIndexForward: true,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      items.push(...(res.Items ?? []).map((i) => this.toEntity(i)));
      exclusiveStartKey = res.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return opts.includeInactive ? items : items.filter((t) => t.active);
  }

  /** `UpdateItem SET active = false` — the template stays resolvable for history. */
  async archive(id: string, at: string = new Date().toISOString()): Promise<void> {
    await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: templatePk(id), SK: METADATA_SK },
        UpdateExpression: 'SET #active = :false, #updatedAt = :at',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: { '#active': 'active', '#updatedAt': 'updatedAt' },
        ExpressionAttributeValues: { ':false': false, ':at': at },
      }),
    );
  }

  /** `Delete TEMPLATE#<id>` — only for templates nothing references. */
  async remove(id: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: templatePk(id), SK: METADATA_SK },
      }),
    );
    this.logger.log(`Deleted message template ${id}`);
  }

  private item(template: MessageTemplate): Record<string, unknown> {
    return {
      PK: templatePk(template.id),
      SK: METADATA_SK,
      GSI3PK: TEMPLATE_CATALOG_GSI3PK,
      GSI3SK: templateCatalogSk(template.messageTemplateTitle, template.id),
      ...compact(template as unknown as Record<string, unknown>),
    };
  }

  private toEntity(item: Record<string, unknown>): MessageTemplate {
    const t = stripKeys<MessageTemplate>(item);
    return { ...t, isDefault: Boolean(t.isDefault), active: t.active !== false };
  }
}
