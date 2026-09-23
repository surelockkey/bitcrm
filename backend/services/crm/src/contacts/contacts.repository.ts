import { ConflictException, Injectable } from '@nestjs/common';
import {
  GetCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  TransactWriteCommand,
  DeleteCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService, scanPage } from '@bitcrm/shared';
import { CrmStatus, type Contact, type Address } from '@bitcrm/types';
import {
  CONTACTS_TABLE,
  CONTACTS_GSI1_NAME,
} from '../common/constants/dynamo.constants';

export interface PaginatedResult {
  items: Contact[];
  nextCursor?: string;
}

@Injectable()
export class ContactsRepository {
  private tableName = CONTACTS_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  async create(contact: Contact): Promise<void> {
    const transactItems: any[] = [
      {
        Put: {
          TableName: this.tableName,
          Item: {
            PK: `CONTACT#${contact.id}`,
            SK: 'METADATA',
            GSI1PK: `COMPANY#${contact.companyId || 'NONE'}`,
            GSI1SK: `CONTACT#${contact.id}`,
            ...contact,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
    ];

    for (const phone of contact.phones) {
      transactItems.push({
        Put: {
          TableName: this.tableName,
          Item: {
            PK: `PHONE#${phone}`,
            SK: `CONTACT#${contact.id}`,
            contactId: contact.id,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      });
    }

    try {
      await this.dynamoDb.client.send(
        new TransactWriteCommand({ TransactItems: transactItems }),
      );
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.name === 'TransactionCanceledException'
      ) {
        throw new ConflictException(
          'Contact with this phone number already exists',
        );
      }
      throw error;
    }
  }

  async findById(id: string): Promise<Contact | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `CONTACT#${id}`, SK: 'METADATA' },
      }),
    );

    if (!result.Item) return null;
    return this.toContact(result.Item);
  }

  /**
   * The contacts of a set of ids, in whatever order DynamoDB answers; ids
   * that no longer exist are simply absent. BatchGet takes 100 keys a call,
   * and keys it leaves unprocessed under load are asked again.
   */
  async findByIds(ids: string[]): Promise<Contact[]> {
    const out: Contact[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      let keys = ids.slice(i, i + 100).map((id) => ({ PK: `CONTACT#${id}`, SK: 'METADATA' }));
      while (keys.length) {
        const res = await this.dynamoDb.client.send(
          new BatchGetCommand({ RequestItems: { [this.tableName]: { Keys: keys } } }),
        );
        for (const item of res.Responses?.[this.tableName] ?? []) out.push(this.toContact(item));
        keys = (res.UnprocessedKeys?.[this.tableName]?.Keys ?? []) as typeof keys;
      }
    }
    return out;
  }

  async findByPhone(normalizedPhone: string): Promise<Contact | null> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `PHONE#${normalizedPhone}` },
        Limit: 1,
      }),
    );

    const items = result.Items || [];
    if (items.length === 0) return null;

    const contactId = items[0].contactId as string;
    return this.findById(contactId);
  }

  async findByCompany(
    companyId: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedResult> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: CONTACTS_GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        FilterExpression: '#status = :active',
        ExpressionAttributeValues: {
          ':pk': `COMPANY#${companyId}`,
          ':active': CrmStatus.ACTIVE,
        },
        ExpressionAttributeNames: { '#status': 'status' },
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    return {
      items: (result.Items || []).map(this.toContact),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  async findAll(
    limit: number,
    cursor?: string,
    filters?: { status?: string },
  ): Promise<PaginatedResult> {
    const statusFilter = filters?.status || CrmStatus.ACTIVE;

    const page = await scanPage<Record<string, unknown>>(
      (input) =>
        this.dynamoDb.client.send(
          new ScanCommand({
            TableName: this.tableName,
            FilterExpression: 'begins_with(PK, :pk) AND SK = :sk AND #status = :status',
            ExpressionAttributeValues: {
              ':pk': 'CONTACT#',
              ':sk': 'METADATA',
              ':status': statusFilter,
            },
            ExpressionAttributeNames: { '#status': 'status' },
            ...input,
          }),
        ),
      limit,
      { startKey: this.decodeCursor(cursor), keyOf: (i) => ({ PK: i.PK, SK: i.SK }) },
    );

    return {
      items: page.items.map(this.toContact),
      nextCursor: this.encodeCursor(page.lastKey),
    };
  }

  async update(id: string, attrs: Partial<Contact>): Promise<Contact> {
    const setParts: string[] = [];
    const expressionNames: Record<string, string> = {};
    const expressionValues: Record<string, unknown> = {};

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { ...attrs, updatedAt: now };

    if (attrs.companyId !== undefined) {
      updates['GSI1PK'] = `COMPANY#${attrs.companyId || 'NONE'}`;
      updates['GSI1SK'] = `CONTACT#${id}`;
    }

    const immutableKeys = new Set(['id', 'createdBy', 'createdAt']);
    for (const [key, value] of Object.entries(updates)) {
      if (immutableKeys.has(key)) continue;
      if (value === undefined) continue;
      const attrName = `#${key}`;
      const attrValue = `:${key}`;
      expressionNames[attrName] = key;
      expressionValues[attrValue] = value;
      setParts.push(`${attrName} = ${attrValue}`);
    }

    const result = await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `CONTACT#${id}`, SK: 'METADATA' },
        UpdateExpression: `SET ${setParts.join(', ')}`,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: expressionValues,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );

    return this.toContact(result.Attributes!);
  }

  async updatePhoneIndex(
    contactId: string,
    oldPhones: string[],
    newPhones: string[],
  ): Promise<void> {
    // Only touch phones that actually changed. Deleting *and* re-Putting an
    // unchanged phone in the same TransactWrite hits the same item twice, which
    // DynamoDB rejects ("Transaction request cannot include multiple operations
    // on one item") — that is why adding a phone to a contact that kept its
    // existing ones used to fail.
    const oldSet = new Set(oldPhones);
    const newSet = new Set(newPhones);
    const toDelete = [...oldSet].filter((phone) => !newSet.has(phone));
    const toAdd = [...newSet].filter((phone) => !oldSet.has(phone));

    const transactItems: any[] = [];

    for (const phone of toDelete) {
      transactItems.push({
        Delete: {
          TableName: this.tableName,
          Key: { PK: `PHONE#${phone}`, SK: `CONTACT#${contactId}` },
        },
      });
    }

    for (const phone of toAdd) {
      transactItems.push({
        Put: {
          TableName: this.tableName,
          Item: {
            PK: `PHONE#${phone}`,
            SK: `CONTACT#${contactId}`,
            contactId,
          },
        },
      });
    }

    if (transactItems.length > 0) {
      await this.dynamoDb.client.send(
        new TransactWriteCommand({ TransactItems: transactItems }),
      );
    }
  }

  private toContact(item: Record<string, unknown>): Contact {
    return {
      id: item.id as string,
      firstName: item.firstName as string,
      lastName: item.lastName as string,
      phones: item.phones as string[],
      // Rows written before extensions existed simply have none.
      phoneExtensions:
        (item.phoneExtensions as Record<string, string> | undefined) || {},
      emails: (item.emails as string[]) || [],
      // Legacy rows predate addresses — default to an empty list on read.
      addresses: (item.addresses as Address[]) || [],
      companyId: item.companyId as string | undefined,
      type: item.type as Contact['type'],
      title: item.title as string | undefined,
      source: item.source as Contact['source'],
      notes: item.notes as string | undefined,
      taxExempt: item.taxExempt as boolean | undefined,
      taxExemptReason: item.taxExemptReason as string | undefined,
      status: item.status as Contact['status'],
      createdBy: item.createdBy as string,
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    };
  }

  private encodeCursor(
    lastEvaluatedKey?: Record<string, unknown>,
  ): string | undefined {
    if (!lastEvaluatedKey) return undefined;
    return Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64url');
  }

  private decodeCursor(
    cursor?: string,
  ): Record<string, unknown> | undefined {
    if (!cursor) return undefined;
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
  }
}
