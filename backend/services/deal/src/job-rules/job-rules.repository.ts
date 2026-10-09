import { Injectable } from '@nestjs/common';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type JobRulesSettings } from '@bitcrm/types';
import { DEALS_TABLE } from '../common/constants/dynamo.constants';
import { JOB_RULES_PK, JOB_RULES_SK } from './job-rules.constants';

/**
 * One config row in the shared deals table — `CONFIG#JOB_RULES / METADATA`:
 * the account's job rules (Workiz Account → Preferences). What is stored is
 * handed back as is; the service decides what a missing or odd value means.
 */
@Injectable()
export class JobRulesRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async get(): Promise<Partial<Record<keyof JobRulesSettings, unknown>> | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({ TableName: DEALS_TABLE, Key: { PK: JOB_RULES_PK, SK: JOB_RULES_SK } }),
    );
    if (!result.Item) return null;
    return { updateJobEndTimeOnClose: result.Item.updateJobEndTimeOnClose };
  }

  async put(settings: JobRulesSettings): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: DEALS_TABLE,
        Item: { PK: JOB_RULES_PK, SK: JOB_RULES_SK, ...settings },
      }),
    );
  }
}
