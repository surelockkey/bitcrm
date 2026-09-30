import { Injectable } from '@nestjs/common';
import {
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { CALLS_TABLE } from '../common/constants/dynamo.constants';

/**
 * Per-number configuration — the job source the number is tracked as
 * (call-tracking attribution: "this number runs in the Google Ads campaign")
 * and the company (business profile) its calls belong to. Kept in the calls table as one small item collection
 * (PK NUMSET#ALL, SK = the E.164 number): a workspace owns a handful of
 * numbers, so the whole list is a single-partition query.
 */
export interface NumberSettings {
  phoneNumber: string;
  /** Job-source catalog id the number attributes calls to. */
  sourceId?: string;
  /** Company (billing business profile) calls through the number belong to. */
  businessProfileId?: string;
}

/** A partial write: undefined keeps a field, null / blank clears it. */
export interface NumberSettingsUpdate {
  sourceId?: string | null;
  businessProfileId?: string | null;
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

  /**
   * Partial update of the number's settings. Each field: undefined → left as
   * is, null / blank → removed, a value → set. Returns what is now stored.
   */
  async put(
    phoneNumber: string,
    settings: NumberSettingsUpdate,
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
    };
    const values: Record<string, unknown> = {
      ':phoneNumber': phoneNumber,
      ':updatedAt': new Date().toISOString(),
      ':updatedBy': updatedBy,
    };

    for (const field of ['sourceId', 'businessProfileId'] as const) {
      const value = settings[field];
      if (value === undefined) continue;
      names[`#${field}`] = field;
      if (typeof value === 'string' && value.trim()) {
        sets.push(`#${field} = :${field}`);
        values[`:${field}`] = value.trim();
      } else {
        removes.push(`#${field}`);
      }
    }

    const expression =
      `SET ${sets.join(', ')}` +
      (removes.length ? ` REMOVE ${removes.join(', ')}` : '');

    const res = await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: SETTINGS_PK, SK: phoneNumber },
        UpdateExpression: expression,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }),
    );
    if (res?.Attributes) return this.toSettings(res.Attributes);
    const clean = (v: string | null | undefined) =>
      typeof v === 'string' && v.trim() ? v.trim() : undefined;
    return {
      phoneNumber,
      sourceId: clean(settings.sourceId),
      businessProfileId: clean(settings.businessProfileId),
    };
  }

  private toSettings(item: Record<string, unknown>): NumberSettings {
    return {
      phoneNumber: (item.phoneNumber as string) ?? (item.SK as string),
      sourceId: (item.sourceId as string) || undefined,
      businessProfileId: (item.businessProfileId as string) || undefined,
    };
  }
}
