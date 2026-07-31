import { Injectable } from '@nestjs/common';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type DealAttachment } from '@bitcrm/types';
import {
  DEALS_TABLE,
  DEAL_ATTACHMENT_SK_PREFIX,
} from '../../common/constants/dynamo.constants';

/** Attachment rows live alongside the deal: PK=DEAL#<id>, SK=ATTACH#<attachmentId>. */
@Injectable()
export class DealAttachmentsRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  private key(dealId: string, id: string) {
    return { PK: `DEAL#${dealId}`, SK: `${DEAL_ATTACHMENT_SK_PREFIX}${id}` };
  }

  async create(att: DealAttachment): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: DEALS_TABLE,
        Item: { ...this.key(att.dealId, att.id), ...att },
      }),
    );
  }

  async get(dealId: string, id: string): Promise<DealAttachment | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({ TableName: DEALS_TABLE, Key: this.key(dealId, id) }),
    );
    return result.Item ? this.toAttachment(result.Item) : null;
  }

  async listByDeal(dealId: string): Promise<DealAttachment[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: DEALS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `DEAL#${dealId}`,
          ':sk': DEAL_ATTACHMENT_SK_PREFIX,
        },
      }),
    );
    return (result.Items || []).map((i) => this.toAttachment(i));
  }

  async delete(dealId: string, id: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({ TableName: DEALS_TABLE, Key: this.key(dealId, id) }),
    );
  }

  private toAttachment(item: Record<string, unknown>): DealAttachment {
    return {
      dealId: item.dealId as string,
      id: item.id as string,
      fileName: item.fileName as string,
      contentType: item.contentType as string,
      size: item.size as number | undefined,
      category: item.category as string | undefined,
      s3Key: item.s3Key as string,
      uploadedBy: item.uploadedBy as string,
      uploadedAt: item.uploadedAt as string,
    };
  }
}
