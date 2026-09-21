import { Injectable } from '@nestjs/common';
import { GetCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import type { PortalLink } from '@bitcrm/types';
import {
  BILLING_TABLE,
  METADATA_SK,
  PORTAL_LINK_SK,
  contactPk,
  portalTokenPk,
  stripKeys,
} from '../common/constants/dynamo.constants';

/** The stored link: public metadata + the hash of the live token (+ the nonce it is derived from). */
export type StoredPortalLink = PortalLink & { tokenHash: string; nonce?: string };

/**
 * Client-portal links, one per contact.
 *
 *   PK = PORTAL#<sha256(token)>, SK = METADATA      → { contactId }   token lookup
 *   PK = CONTACT#<contactId>,   SK = PORTAL_LINK   → link metadata + tokenHash
 *
 * Regenerating swaps both rows in one transaction and deletes the old token
 * row, so an old URL stops working the moment a new one exists.
 */
@Injectable()
export class PortalRepository {
  constructor(private readonly db: DynamoDbService) {}

  async getLink(contactId: string): Promise<StoredPortalLink | null> {
    const res = await this.db.client.send(
      new GetCommand({ TableName: BILLING_TABLE, Key: { PK: contactPk(contactId), SK: PORTAL_LINK_SK } }),
    );
    return stripKeys<StoredPortalLink>(res.Item);
  }

  async findContactByTokenHash(tokenHash: string): Promise<string | null> {
    const res = await this.db.client.send(
      new GetCommand({ TableName: BILLING_TABLE, Key: { PK: portalTokenPk(tokenHash), SK: METADATA_SK } }),
    );
    return (res.Item?.contactId as string | undefined) ?? null;
  }

  async saveLink(link: StoredPortalLink, previousTokenHash?: string): Promise<void> {
    const items: NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']> = [
      {
        Put: {
          TableName: BILLING_TABLE,
          Item: {
            PK: portalTokenPk(link.tokenHash),
            SK: METADATA_SK,
            entityType: 'portal_token',
            contactId: link.contactId,
            createdAt: link.createdAt,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
      {
        Put: {
          TableName: BILLING_TABLE,
          Item: { PK: contactPk(link.contactId), SK: PORTAL_LINK_SK, entityType: 'portal_link', ...link },
        },
      },
    ];
    if (previousTokenHash && previousTokenHash !== link.tokenHash) {
      items.push({
        Delete: { TableName: BILLING_TABLE, Key: { PK: portalTokenPk(previousTokenHash), SK: METADATA_SK } },
      });
    }
    await this.db.client.send(new TransactWriteCommand({ TransactItems: items }));
  }

  async deleteLink(contactId: string, tokenHash: string): Promise<void> {
    await this.db.client.send(
      new TransactWriteCommand({
        TransactItems: [
          { Delete: { TableName: BILLING_TABLE, Key: { PK: portalTokenPk(tokenHash), SK: METADATA_SK } } },
          { Delete: { TableName: BILLING_TABLE, Key: { PK: contactPk(contactId), SK: PORTAL_LINK_SK } } },
        ],
      }),
    );
  }

  async touchViewed(contactId: string, now: string): Promise<void> {
    await this.db.client.send(
      new UpdateCommand({
        TableName: BILLING_TABLE,
        Key: { PK: contactPk(contactId), SK: PORTAL_LINK_SK },
        UpdateExpression: 'SET lastViewedAt = :now',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeValues: { ':now': now },
      }),
    );
  }
}
