import { Injectable } from '@nestjs/common';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type JobFieldSettings } from '@bitcrm/types';
import { DEALS_TABLE } from '../common/constants/dynamo.constants';

const PK = 'CONFIG#JOB_FIELDS';
const SK = 'METADATA';

/** One config row in the shared deals table: which job fields are required. */
@Injectable()
export class JobFieldSettingsRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async get(): Promise<JobFieldSettings | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({ TableName: DEALS_TABLE, Key: { PK, SK } }),
    );
    if (!result.Item) return null;
    return { requiredFields: (result.Item.requiredFields as Record<string, boolean>) ?? {} };
  }

  async put(settings: JobFieldSettings): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: DEALS_TABLE,
        Item: { PK, SK, requiredFields: settings.requiredFields },
      }),
    );
  }
}
