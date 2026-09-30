import { Injectable } from '@nestjs/common';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import type { BusinessProfile } from '@bitcrm/types';
import {
  BILLING_GSI1_NAME,
  BILLING_TABLE,
  BUSINESS_PROFILES_GSI1PK,
  BUSINESS_PROFILE_SK,
  METADATA_SK,
  SETTINGS_PK,
  businessProfilePk,
  listSk,
  stripKeys,
} from '../common/constants/dynamo.constants';
import { isConditionalCheckFailed, isTransactionCanceled } from '../common/dynamo-errors';

/**
 * Companies (business profiles).
 *
 *   PK = BUSINESS_PROFILE#<id>, SK = METADATA
 *   GSI1 (ListIndex): GSI1PK = BUSINESS_PROFILES, GSI1SK = <createdAt>#<id>
 *
 * A handful of rows — the partition is read whole. The pre-Revision-2
 * singleton lives at PK = SETTINGS, SK = BUSINESS_PROFILE until it is migrated.
 */
@Injectable()
export class BusinessProfileRepository {
  constructor(private readonly db: DynamoDbService) {}

  private item(p: BusinessProfile) {
    return {
      PK: businessProfilePk(p.id),
      SK: METADATA_SK,
      GSI1PK: BUSINESS_PROFILES_GSI1PK,
      GSI1SK: listSk(p.createdAt ?? '', p.id),
      entityType: 'business_profile',
      ...p,
    };
  }

  async list(): Promise<BusinessProfile[]> {
    const out: BusinessProfile[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const res = await this.db.client.send(
        new QueryCommand({
          TableName: BILLING_TABLE,
          IndexName: BILLING_GSI1_NAME,
          KeyConditionExpression: 'GSI1PK = :pk',
          ExpressionAttributeValues: { ':pk': BUSINESS_PROFILES_GSI1PK },
          ExclusiveStartKey: cursor,
        }),
      );
      for (const item of res.Items ?? []) out.push(stripKeys<BusinessProfile>(item)!);
      cursor = res.LastEvaluatedKey;
    } while (cursor);
    return out;
  }

  async get(id: string): Promise<BusinessProfile | null> {
    const res = await this.db.client.send(
      new GetCommand({ TableName: BILLING_TABLE, Key: { PK: businessProfilePk(id), SK: METADATA_SK } }),
    );
    return stripKeys<BusinessProfile>(res.Item);
  }

  /** Insert; throws if the id already exists. */
  async create(p: BusinessProfile): Promise<void> {
    await this.db.client.send(
      new PutCommand({
        TableName: BILLING_TABLE,
        Item: this.item(p),
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }

  /** Full replace of an existing company. */
  async put(p: BusinessProfile): Promise<void> {
    await this.db.client.send(
      new PutCommand({
        TableName: BILLING_TABLE,
        Item: this.item(p),
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.client.send(
      new DeleteCommand({ TableName: BILLING_TABLE, Key: { PK: businessProfilePk(id), SK: METADATA_SK } }),
    );
  }

  /** Makes `id` the only default among `others`, atomically. */
  async setDefault(id: string, others: string[], now: string): Promise<void> {
    const flag = (pid: string, value: boolean) => ({
      Update: {
        TableName: BILLING_TABLE,
        Key: { PK: businessProfilePk(pid), SK: METADATA_SK },
        UpdateExpression: 'SET isDefault = :v, updatedAt = :now',
        ConditionExpression: value ? 'attribute_exists(PK) AND active = :t' : 'attribute_exists(PK)',
        ExpressionAttributeValues: { ':v': value, ':now': now, ...(value && { ':t': true }) },
      },
    });
    const items = [flag(id, true), ...others.filter((o) => o !== id).map((o) => flag(o, false))];
    await this.db.client.send(new TransactWriteCommand({ TransactItems: items.slice(0, 100) }));
  }

  /** The pre-Revision-2 singleton, if it is still there. */
  async getLegacy(): Promise<Partial<BusinessProfile> | null> {
    const res = await this.db.client.send(
      new GetCommand({ TableName: BILLING_TABLE, Key: { PK: SETTINGS_PK, SK: BUSINESS_PROFILE_SK } }),
    );
    return stripKeys<Partial<BusinessProfile>>(res.Item);
  }

  /**
   * Moves the singleton into its company row in one transaction: the new row
   * is written only if absent and the legacy row is deleted only if present.
   * Returns false when another instance won the race (nothing written).
   */
  async migrateLegacy(p: BusinessProfile): Promise<boolean> {
    try {
      await this.db.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: BILLING_TABLE,
                Item: this.item(p),
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
            {
              Delete: {
                TableName: BILLING_TABLE,
                Key: { PK: SETTINGS_PK, SK: BUSINESS_PROFILE_SK },
                ConditionExpression: 'attribute_exists(PK)',
              },
            },
          ],
        }),
      );
      return true;
    } catch (err) {
      if (isTransactionCanceled(err) || isConditionalCheckFailed(err)) return false;
      throw err;
    }
  }
}
