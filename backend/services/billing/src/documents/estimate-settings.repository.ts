import { Injectable } from '@nestjs/common';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import type { EstimateSettings } from '@bitcrm/types';
import { BILLING_TABLE, ESTIMATE_SETTINGS_SK, SETTINGS_PK, stripKeys } from '../common/constants/dynamo.constants';

/** `SETTINGS` / ESTIMATES — the EstimateSettings singleton. No row until someone saves. */
@Injectable()
export class EstimateSettingsRepository {
  constructor(private readonly db: DynamoDbService) {}

  async getSettings(): Promise<Partial<EstimateSettings> | undefined> {
    const res = await this.db.client.send(
      new GetCommand({ TableName: BILLING_TABLE, Key: { PK: SETTINGS_PK, SK: ESTIMATE_SETTINGS_SK } }),
    );
    return stripKeys<Partial<EstimateSettings>>(res.Item) ?? undefined;
  }

  async putSettings(settings: EstimateSettings): Promise<EstimateSettings> {
    await this.db.client.send(
      new PutCommand({
        TableName: BILLING_TABLE,
        Item: { PK: SETTINGS_PK, SK: ESTIMATE_SETTINGS_SK, entityType: 'estimate_settings', ...settings },
      }),
    );
    return settings;
  }
}
