import { Injectable } from '@nestjs/common';
import {
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { CALLS_TABLE } from '../common/constants/dynamo.constants';

/**
 * Per-number configuration — today just the job source the number is tracked
 * as (call-tracking attribution: "this number runs in the Google Ads
 * campaign"). Kept in the calls table as one small item collection
 * (PK NUMSET#ALL, SK = the E.164 number): a workspace owns a handful of
 * numbers, so the whole list is a single-partition query.
 */
export interface NumberSettings {
  phoneNumber: string;
  /** Job-source catalog id the number attributes calls to. */
  sourceId?: string;
}

const SETTINGS_PK = 'NUMSET#ALL';

@Injectable()
export class NumberSettingsRepository {
  private tableName = CALLS_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  async get(phoneNumber: string): Promise<NumberSettings | null> {
    const res = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: SETTINGS_PK, SK: phoneNumber },
      }),
    );
    if (!res.Item) return null;
    return this.toSettings(res.Item);
  }

  async list(): Promise<NumberSettings[]> {
    const res = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': SETTINGS_PK },
      }),
    );
    return (res.Items ?? []).map((item) => this.toSettings(item));
  }

  /** Assign (or, with `sourceId: null`, clear) the number's job source. */
  async put(
    phoneNumber: string,
    settings: { sourceId?: string | null },
    updatedBy: string,
  ): Promise<NumberSettings> {
    const sets = [
      '#phoneNumber = :phoneNumber',
      '#updatedAt = :updatedAt',
      '#updatedBy = :updatedBy',
    ];
    const removes: string[] = [];
    const names: Record<string, string> = {
      '#phoneNumber': 'phoneNumber',
      '#updatedAt': 'updatedAt',
      '#updatedBy': 'updatedBy',
      '#sourceId': 'sourceId',
    };
    const values: Record<string, unknown> = {
      ':phoneNumber': phoneNumber,
      ':updatedAt': new Date().toISOString(),
      ':updatedBy': updatedBy,
    };

    if (settings.sourceId) {
      sets.push('#sourceId = :sourceId');
      values[':sourceId'] = settings.sourceId;
    } else {
      removes.push('#sourceId');
    }

    const expression =
      `SET ${sets.join(', ')}` +
      (removes.length ? ` REMOVE ${removes.join(', ')}` : '');

    await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: SETTINGS_PK, SK: phoneNumber },
        UpdateExpression: expression,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
    return { phoneNumber, sourceId: settings.sourceId ?? undefined };
  }

  private toSettings(item: Record<string, unknown>): NumberSettings {
    return {
      phoneNumber: (item.phoneNumber as string) ?? (item.SK as string),
      sourceId: (item.sourceId as string) || undefined,
    };
  }
}
