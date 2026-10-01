import { Injectable } from '@nestjs/common';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import type { Proposal } from '@bitcrm/types';
import {
  ACCOUNT_COUNTERS_PK,
  BILLING_GSI2_NAME,
  BILLING_GSI3_NAME,
  BILLING_TABLE,
  COUNTERS_SK,
  METADATA_SK,
  contactGsi2Pk,
  contactGsi2Sk,
  dealGsi3Pk,
  proposalGsi3Sk,
  proposalPk,
  stripKeys,
} from '../common/constants/dynamo.constants';
import { buildUpdate } from '../common/update-expression';

/**
 * Sales proposals.
 *
 *   PK = PROPOSAL#<id>, SK = METADATA
 *     GSI2 (ContactIndex): GSI2PK = CONTACT#<contactId>, GSI2SK = PROPOSAL#<createdAt>#<id>
 *     GSI3 (DealIndex):    GSI3PK = DEAL#<dealId>,       GSI3SK = PROPOSAL#<createdAt>#<id>
 *   COUNTERS#ACCOUNT / COUNTERS — `proposalSeq`, ADDed per proposal (Workiz "Proposal #256")
 */
@Injectable()
export class ProposalsRepository {
  constructor(private readonly db: DynamoDbService) {}

  async nextSeq(): Promise<number> {
    const res = await this.db.client.send(
      new UpdateCommand({
        TableName: BILLING_TABLE,
        Key: { PK: ACCOUNT_COUNTERS_PK, SK: COUNTERS_SK },
        UpdateExpression: 'ADD proposalSeq :one',
        ExpressionAttributeValues: { ':one': 1 },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    return Number(res.Attributes?.proposalSeq ?? 1);
  }

  async create(p: Proposal): Promise<void> {
    await this.db.client.send(
      new PutCommand({
        TableName: BILLING_TABLE,
        Item: {
          PK: proposalPk(p.id),
          SK: METADATA_SK,
          entityType: 'proposal',
          GSI2PK: contactGsi2Pk(p.contactId),
          GSI2SK: contactGsi2Sk('PROPOSAL', p.createdAt, p.id),
          GSI3PK: dealGsi3Pk(p.dealId),
          GSI3SK: proposalGsi3Sk(p.createdAt, p.id),
          ...p,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }

  async get(id: string): Promise<Proposal | null> {
    const res = await this.db.client.send(
      new GetCommand({ TableName: BILLING_TABLE, Key: { PK: proposalPk(id), SK: METADATA_SK } }),
    );
    return stripKeys<Proposal>(res.Item);
  }

  async update(id: string, set: Partial<Proposal>, remove: string[] = []): Promise<Proposal> {
    const patch: Record<string, unknown> = { ...set };
    delete patch.version;
    const expr = buildUpdate(patch, remove, { incrementVersion: true });
    const res = await this.db.client.send(
      new UpdateCommand({
        TableName: BILLING_TABLE,
        Key: { PK: proposalPk(id), SK: METADATA_SK },
        ...expr,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );
    return stripKeys<Proposal>(res.Attributes)!;
  }

  listByDeal(dealId: string): Promise<Proposal[]> {
    return this.query(BILLING_GSI3_NAME, 'GSI3PK = :pk AND begins_with(GSI3SK, :sk)', {
      ':pk': dealGsi3Pk(dealId),
      ':sk': 'PROPOSAL#',
    });
  }

  listByContact(contactId: string): Promise<Proposal[]> {
    return this.query(BILLING_GSI2_NAME, 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)', {
      ':pk': contactGsi2Pk(contactId),
      ':sk': 'PROPOSAL#',
    });
  }

  private async query(index: string, key: string, values: Record<string, unknown>): Promise<Proposal[]> {
    const out: Proposal[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.client.send(
        new QueryCommand({
          TableName: BILLING_TABLE,
          IndexName: index,
          KeyConditionExpression: key,
          ExpressionAttributeValues: values,
          ExclusiveStartKey,
        }),
      );
      out.push(...(res.Items ?? []).map((i) => stripKeys<Proposal>(i)!));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
  }
}
