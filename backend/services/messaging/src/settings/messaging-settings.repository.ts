import { Injectable } from '@nestjs/common';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type MessagingSettings } from '@bitcrm/types';
import { MESSAGING_TABLE, METADATA_SK, SETTINGS_PK } from '../common/constants/dynamo.constants';
import { compact, stripKeys } from '../common/items';

/**
 * `MESSAGING#SETTINGS` / `METADATA` — one item, like `TELEPHONY#SETTINGS`
 * (design §3.2). Whole-document Put: settings are edited on one form and
 * the fields have no independent writers.
 */
@Injectable()
export class MessagingSettingsRepository {
  private tableName = MESSAGING_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  /** `GetItem MESSAGING#SETTINGS`; `null` until first saved. */
  async get(): Promise<MessagingSettings | null> {
    const res = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: SETTINGS_PK, SK: METADATA_SK },
      }),
    );
    return res.Item ? stripKeys<MessagingSettings>(res.Item) : null;
  }

  /** `Put MESSAGING#SETTINGS` — replaces the document, stamps `updatedAt/By`. */
  async put(
    settings: MessagingSettings,
    updatedBy: string,
    at: string = new Date().toISOString(),
  ): Promise<MessagingSettings> {
    const next: MessagingSettings = { ...settings, updatedAt: at, updatedBy };
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: SETTINGS_PK,
          SK: METADATA_SK,
          ...compact(next as unknown as Record<string, unknown>),
        },
      }),
    );
    return next;
  }
}
