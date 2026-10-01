import { Injectable } from '@nestjs/common';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type ContactAttachment, type DealAttachment } from '@bitcrm/types';
import {
  CONTACT_PK_PREFIX,
  DEALS_TABLE,
  DEAL_ATTACHMENT_SK_PREFIX,
} from '../../common/constants/dynamo.constants';
import {
  CONTACT_ACTIVITY_INDEX,
  attachmentContactKeys,
  contactFilePk,
} from '../../contacts/contact-index';

type Key = { PK: string; SK: string };

/** A patch to a file's editable metadata. */
export interface AttachmentPatch {
  fileName?: string;
  description?: string;
}

/** One page of a client's files, job files and the client's own together. */
export interface ContactFilesPage {
  /** Job files carry `dealId`; the client's own files have none. */
  items: (DealAttachment | ContactAttachment)[];
  nextCursor?: string;
}

/**
 * Attachment rows live alongside their owner:
 *
 *   DEAL#<dealId>       / ATTACH#<attachmentId>   a job's file
 *   CONTACT#<contactId> / ATTACH#<attachmentId>   the client's own file (no job)
 *
 * Both are filed, sparsely, on GSI10 ContactActivityIndex as
 * `CONTACTFILE#<contactId>` / `<uploadedAt>#<id>` when the client is known
 * (`contacts/contact-index.ts`) — the client card's Files, newest first.
 */
@Injectable()
export class DealAttachmentsRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  private key(dealId: string, id: string): Key {
    return { PK: `DEAL#${dealId}`, SK: `${DEAL_ATTACHMENT_SK_PREFIX}${id}` };
  }

  private contactKey(contactId: string, id: string): Key {
    return { PK: `${CONTACT_PK_PREFIX}${contactId}`, SK: `${DEAL_ATTACHMENT_SK_PREFIX}${id}` };
  }

  // ------------------------------------------------------------ job files

  async create(att: DealAttachment): Promise<void> {
    const contact = att.contactId ? attachmentContactKeys(att.contactId, att.uploadedAt, att.id) : null;
    await this.put({ ...this.key(att.dealId, att.id), ...att, ...contact });
  }

  async get(dealId: string, id: string): Promise<DealAttachment | null> {
    const item = await this.getItem(this.key(dealId, id));
    return item ? this.toAttachment(item) : null;
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

  async update(dealId: string, id: string, patch: AttachmentPatch): Promise<DealAttachment> {
    return this.toAttachment(await this.updateItem(this.key(dealId, id), patch));
  }

  async delete(dealId: string, id: string): Promise<void> {
    await this.deleteItem(this.key(dealId, id));
  }

  // ----------------------------------------------------- the client's own files

  async createForContact(att: ContactAttachment): Promise<void> {
    await this.put({
      ...this.contactKey(att.contactId, att.id),
      ...att,
      ...attachmentContactKeys(att.contactId, att.uploadedAt, att.id),
    });
  }

  async getForContact(contactId: string, id: string): Promise<ContactAttachment | null> {
    const item = await this.getItem(this.contactKey(contactId, id));
    return item ? this.toContactAttachment(item) : null;
  }

  async updateForContact(contactId: string, id: string, patch: AttachmentPatch): Promise<ContactAttachment> {
    return this.toContactAttachment(await this.updateItem(this.contactKey(contactId, id), patch));
  }

  async deleteForContact(contactId: string, id: string): Promise<void> {
    await this.deleteItem(this.contactKey(contactId, id));
  }

  // ------------------------------------------------------- the client card

  /** Every file of the client — its jobs' and its own — newest first. */
  async listByContact(contactId: string, limit: number, cursor?: string): Promise<ContactFilesPage> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: DEALS_TABLE,
        IndexName: CONTACT_ACTIVITY_INDEX,
        KeyConditionExpression: 'GSI10PK = :pk',
        ExpressionAttributeValues: { ':pk': contactFilePk(contactId) },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: cursor
          ? JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'))
          : undefined,
      }),
    );
    return {
      items: (result.Items || []).map((i) =>
        typeof i.dealId === 'string' ? this.toAttachment(i) : this.toContactAttachment(i),
      ),
      nextCursor: result.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url')
        : undefined,
    };
  }

  // ------------------------------------------------------------- plumbing

  private async put(item: Record<string, unknown>): Promise<void> {
    await this.dynamoDb.client.send(new PutCommand({ TableName: DEALS_TABLE, Item: item }));
  }

  private async getItem(key: Key): Promise<Record<string, unknown> | undefined> {
    const result = await this.dynamoDb.client.send(new GetCommand({ TableName: DEALS_TABLE, Key: key }));
    return result.Item;
  }

  private async updateItem(key: Key, patch: AttachmentPatch): Promise<Record<string, unknown>> {
    const sets: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      sets.push(`#${k} = :${k}`);
      names[`#${k}`] = k;
      values[`:${k}`] = v;
    }
    const result = await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: DEALS_TABLE,
        Key: key,
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }),
    );
    return result.Attributes || {};
  }

  private async deleteItem(key: Key): Promise<void> {
    await this.dynamoDb.client.send(new DeleteCommand({ TableName: DEALS_TABLE, Key: key }));
  }

  private fileFields(item: Record<string, unknown>) {
    return {
      id: item.id as string,
      fileName: item.fileName as string,
      contentType: item.contentType as string,
      size: item.size as number | undefined,
      category: item.category as string | undefined,
      description: item.description as string | undefined,
      s3Key: item.s3Key as string,
      uploadedBy: item.uploadedBy as string,
      uploadedAt: item.uploadedAt as string,
    };
  }

  private toAttachment(item: Record<string, unknown>): DealAttachment {
    return {
      dealId: item.dealId as string,
      ...(typeof item.contactId === 'string' && { contactId: item.contactId }),
      ...this.fileFields(item),
    };
  }

  private toContactAttachment(item: Record<string, unknown>): ContactAttachment {
    return { contactId: item.contactId as string, ...this.fileFields(item) };
  }
}
