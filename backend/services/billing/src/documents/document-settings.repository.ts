import { Injectable } from '@nestjs/common';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import type { DocumentSettings } from '@bitcrm/types';
import { BILLING_TABLE, DOCUMENT_SETTINGS_SK, SETTINGS_PK, stripKeys } from '../common/constants/dynamo.constants';

/** `SETTINGS` / DOCUMENTS — the DocumentSettings singleton. No row until someone saves. */
@Injectable()
export class DocumentSettingsRepository {
  constructor(private readonly db: DynamoDbService) {}

  async getSettings(): Promise<Partial<DocumentSettings> | undefined> {
    const res = await this.db.client.send(
      new GetCommand({ TableName: BILLING_TABLE, Key: { PK: SETTINGS_PK, SK: DOCUMENT_SETTINGS_SK } }),
    );
    return stripKeys<Partial<DocumentSettings>>(res.Item) ?? undefined;
  }

  async putSettings(settings: DocumentSettings): Promise<DocumentSettings> {
    await this.db.client.send(
      new PutCommand({
        TableName: BILLING_TABLE,
        Item: { PK: SETTINGS_PK, SK: DOCUMENT_SETTINGS_SK, entityType: 'document_settings', ...settings },
      }),
    );
    return settings;
  }
}
