import { Injectable } from '@nestjs/common';
import { BatchGetCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import type { BillingAsset } from '@bitcrm/types';
import { BILLING_TABLE, METADATA_SK, assetPk, stripKeys } from '../common/constants/dynamo.constants';

/**
 * Template image assets (metadata only — bytes are in S3 `billing/assets/<id>`).
 *
 *   PK = ASSET#<id>, SK = METADATA
 */
@Injectable()
export class AssetsRepository {
  constructor(private readonly db: DynamoDbService) {}

  async create(asset: BillingAsset): Promise<void> {
    await this.db.client.send(
      new PutCommand({
        TableName: BILLING_TABLE,
        Item: { PK: assetPk(asset.id), SK: METADATA_SK, entityType: 'asset', ...asset },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }

  async get(id: string): Promise<BillingAsset | null> {
    const res = await this.db.client.send(
      new GetCommand({ TableName: BILLING_TABLE, Key: { PK: assetPk(id), SK: METADATA_SK } }),
    );
    return stripKeys<BillingAsset>(res.Item);
  }

  async getMany(ids: string[]): Promise<BillingAsset[]> {
    const unique = [...new Set(ids)].slice(0, 100);
    if (!unique.length) return [];
    const res = await this.db.client.send(
      new BatchGetCommand({
        RequestItems: {
          [BILLING_TABLE]: { Keys: unique.map((id) => ({ PK: assetPk(id), SK: METADATA_SK })) },
        },
      }),
    );
    return (res.Responses?.[BILLING_TABLE] ?? []).map((i) => stripKeys<BillingAsset>(i)!);
  }
}
