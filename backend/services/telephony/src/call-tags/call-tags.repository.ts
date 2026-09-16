import { Injectable, Logger } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type CallTag } from '@bitcrm/types';
import { CALLS_TABLE } from '../common/constants/dynamo.constants';
import { CALL_TAG_PK, callTagSk } from './call-tags.constants';

/**
 * Call-tag catalog rows in the calls table:
 *   PK = CALLTAG#ALL, SK = CALLTAG#<id>
 *
 * Stored whole — a tag is a handful of scalars, so a full PutItem is the
 * update path and there is no partial-write race worth designing around.
 * Rows are never deleted (see CallTagsService.archive): the log they label
 * is far too large to check for references.
 */
@Injectable()
export class CallTagsRepository {
  private readonly logger = new Logger(CallTagsRepository.name);

  constructor(private readonly dynamoDb: DynamoDbService) {}

  private item(tag: CallTag): Record<string, unknown> {
    return { PK: CALL_TAG_PK, SK: callTagSk(tag.id), ...tag };
  }

  /**
   * The whole catalog. Read consistently: the partition is tens of items (a
   * workspace has ~28 call tags), and the alternative is a tag created a
   * second ago being missing from the read that decides whether tagging a call
   * with it is a 404 — the picker's "Create new" does exactly create-then-attach.
   */
  async listAll(): Promise<CallTag[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: CALLS_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': CALL_TAG_PK },
        ConsistentRead: true,
      }),
    );
    return (result.Items ?? []).map((i) => this.toEntity(i));
  }

  async get(id: string): Promise<CallTag | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: CALLS_TABLE,
        Key: { PK: CALL_TAG_PK, SK: callTagSk(id) },
      }),
    );
    return result.Item ? this.toEntity(result.Item) : null;
  }

  /** Insert; fails if the id is somehow taken. */
  async create(tag: CallTag): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: CALLS_TABLE,
        Item: this.item(tag),
        ConditionExpression: 'attribute_not_exists(SK)',
      }),
    );
    this.logger.log(`Created call tag ${tag.id} (${tag.name})`);
  }

  /** Full replace of an existing tag (rename, recolor, archive, restore). */
  async put(tag: CallTag): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({ TableName: CALLS_TABLE, Item: this.item(tag) }),
    );
  }

  /**
   * Tolerant of rows written by the importer: `id` falls back to the SK and
   * `active` defaults to true, so a minimal `{name}` item still lists.
   */
  private toEntity(item: Record<string, unknown>): CallTag {
    const sk = (item.SK as string | undefined) ?? '';
    return {
      id: (item.id as string) ?? sk.slice('CALLTAG#'.length),
      name: item.name as string,
      color: (item.color as CallTag['color']) ?? 'slate',
      priority: typeof item.priority === 'number' ? item.priority : 0,
      active: item.active === undefined ? true : Boolean(item.active),
      externalId: (item.externalId as string) || undefined,
      createdBy: (item.createdBy as string) ?? 'import',
      createdAt: (item.createdAt as string) ?? '',
      updatedBy: (item.updatedBy as string) || undefined,
      updatedAt: (item.updatedAt as string) ?? (item.createdAt as string) ?? '',
    };
  }
}
