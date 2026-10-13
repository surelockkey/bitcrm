import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  GetCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  TransactWriteCommand,
  DeleteCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  DynamoDbService,
  scanPage,
  countRows,
  type CountRowsResult,
} from '@bitcrm/shared';
import { CrmStatus, type Contact, type Address } from '@bitcrm/types';
import {
  CONTACTS_TABLE,
  CONTACTS_GSI1_NAME,
  CONTACTS_GSI2_NAME,
} from '../common/constants/dynamo.constants';
import {
  CONTACT_LIST_PK,
  CONTACT_LIST_STATE_KEY,
  contactListKeys,
  contactListWrite,
  hasContactListCursorKeys,
  isMissingIndexError,
  planContactList,
} from './contact-list-index';

export interface PaginatedResult {
  items: Contact[];
  nextCursor?: string;
}

/** How often a not-yet-ready ContactListIndex is asked about again. */
const LIST_INDEX_READY_RECHECK_MS = 60_000;

/**
 * Rows asked of one read when a tag filter thins the index partition: a
 * DynamoDB page stops at 1 MB first (~1 KB rows), so every read is as large
 * as a read can be and the ~5 MB partition is a handful of reads.
 */
const TAGGED_INDEX_READ_ROWS = 1000;

/** Contacts BatchGet asks of one call (DynamoDB's ceiling), and calls in flight at once. */
const BATCH_GET_KEYS = 100;
const BATCH_GET_PARALLEL = 4;
const BATCH_GET_ATTEMPTS = 5;
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Contact rows in the BitCRM_Contacts table:
 *   PK = CONTACT#<id>, SK = METADATA
 *     GSI1PK = COMPANY#<companyId|NONE>, GSI1SK = CONTACT#<id>   (CompanyIndex)
 *     GSI2PK = CONTACTS#ACTIVE, GSI2SK = <name lowercased>#<id>   (ContactListIndex,
 *       sparse: active contacts only — the client list A→Z; kept by `create` and
 *       after every `update`, reconciled by `backfill:contact-list-index`)
 *   PK = PHONE#<e164>, SK = CONTACT#<id>    phone → contact pointer
 *   PK = CONTACT#<id>, SK = NOTE#<ts>#<id>  client notes (ContactNotesRepository)
 *   PK = CONTACTLISTINDEX, SK = STATE       the list index's readiness row
 */
@Injectable()
export class ContactsRepository {
  private readonly logger = new Logger(ContactsRepository.name);
  private tableName = CONTACTS_TABLE;
  /** `listIndexReady`'s answer and when it was read; `true` is kept for good. */
  private listIndexReadyState?: { ready: boolean; at: number };

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
            ...contactListKeys({ PK: `CONTACT#${contact.id}`, SK: 'METADATA', ...contact }),
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
   * that no longer exist are simply absent. BatchGet takes 100 keys a call;
   * the calls run a few at a time (a schedule board names hundreds of
   * clients), and keys left unprocessed under load are asked again after a
   * short, growing pause.
   */
  async findByIds(ids: string[]): Promise<Contact[]> {
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += BATCH_GET_KEYS) chunks.push(ids.slice(i, i + BATCH_GET_KEYS));
    const out: Contact[] = [];
    let next = 0;
    const worker = async () => {
      while (next < chunks.length) {
        const chunk = chunks[next++];
        let keys = chunk.map((id) => ({ PK: `CONTACT#${id}`, SK: 'METADATA' }));
        for (let attempt = 0; keys.length; attempt++) {
          if (attempt > 0) await pause(Math.min(25 * 2 ** (attempt - 1), 400));
          const res = await this.dynamoDb.client.send(
            new BatchGetCommand({ RequestItems: { [this.tableName]: { Keys: keys } } }),
          );
          for (const item of res.Responses?.[this.tableName] ?? []) out.push(this.toContact(item));
          keys = (res.UnprocessedKeys?.[this.tableName]?.Keys ?? []) as typeof keys;
          if (keys.length && attempt + 1 >= BATCH_GET_ATTEMPTS) {
            throw new Error(`BatchGet left ${keys.length} contact keys unprocessed after ${BATCH_GET_ATTEMPTS} attempts`);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(BATCH_GET_PARALLEL, chunks.length) }, worker));
    return out;
  }

  async findByPhone(normalizedPhone: string): Promise<Contact | null> {
    const contactId = await this.findIdByPhone(normalizedPhone);
    return contactId ? this.findById(contactId) : null;
  }

  /**
   * The contact id a `PHONE#<e164>` pointer row names, without reading the
   * contact — batch callers collect the ids first and BatchGet them once.
   */
  async findIdByPhone(normalizedPhone: string): Promise<string | null> {
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
    return (items[0].contactId as string) || null;
  }

  async findByCompany(
    companyId: string,
    limit: number,
    cursor?: string,
    filters?: { tagIds?: string[] },
  ): Promise<PaginatedResult> {
    const tags = tagFilter(filters?.tagIds);
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: CONTACTS_GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        FilterExpression: `#status = :active${tags.expression}`,
        ExpressionAttributeValues: {
          ':pk': `COMPANY#${companyId}`,
          ':active': CrmStatus.ACTIVE,
          ...tags.values,
        },
        ExpressionAttributeNames: { '#status': 'status', ...tags.names },
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
    filters?: { status?: string; tagIds?: string[] },
  ): Promise<PaginatedResult> {
    const statusFilter = filters?.status || CrmStatus.ACTIVE;
    const tags = tagFilter(filters?.tagIds);

    const page = await scanPage<Record<string, unknown>>(
      (input) =>
        this.dynamoDb.client.send(
          new ScanCommand({
            TableName: this.tableName,
            FilterExpression: `begins_with(PK, :pk) AND SK = :sk AND #status = :status${tags.expression}`,
            ExpressionAttributeValues: {
              ':pk': 'CONTACT#',
              ':sk': 'METADATA',
              ':status': statusFilter,
              ...tags.values,
            },
            ExpressionAttributeNames: { '#status': 'status', ...tags.names },
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

  /**
   * How many contacts the list holds — the number behind "Page 2 of 7".
   *
   * The same Scan the list runs, with `Select: 'COUNT'` so no bodies travel.
   * Bounded, because the contacts table is shared with the PHONE# index items
   * and a count must not walk all of it on every page load.
   */
  async countAll(filters?: { status?: string; tagIds?: string[] }): Promise<CountRowsResult> {
    const statusFilter = filters?.status || CrmStatus.ACTIVE;
    const tags = tagFilter(filters?.tagIds);

    return countRows((input) =>
      this.dynamoDb.client.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: `begins_with(PK, :pk) AND SK = :sk AND #status = :status${tags.expression}`,
          ExpressionAttributeValues: {
            ':pk': 'CONTACT#',
            ':sk': 'METADATA',
            ':status': statusFilter,
            ...tags.values,
          },
          ExpressionAttributeNames: { '#status': 'status', ...tags.names },
          Select: 'COUNT',
          ...input,
        }),
      ),
    );
  }

  /**
   * The client list — every active contact — off the ContactListIndex
   * (`CONTACTS#ACTIVE`, name order) once its readiness row exists, else the
   * Scan it has always been. Untagged it is one Query of exactly one page;
   * tagged, the filter runs on the index read and the page is filled across
   * reads. A cursor the Scan handed out (a tab open across the switch) keeps
   * Scanning; an index cursor resumes the index. A readiness row without the
   * index (backfill run before Terraform) falls back to the Scan.
   */
  async findActive(
    limit: number,
    cursor?: string,
    filters?: { tagIds?: string[] },
  ): Promise<PaginatedResult> {
    const startKey = this.decodeCursor(cursor);
    if (startKey && !hasContactListCursorKeys(startKey)) return this.findAll(limit, cursor, filters);
    // An index cursor means the index was being read: resume it whatever this
    // task last heard about readiness (another task may have seen it first).
    if (!startKey && !(await this.listIndexReady())) return this.findAll(limit, undefined, filters);
    try {
      return await this.queryListIndex(limit, startKey, filters);
    } catch (error) {
      if (!isMissingIndexError(error)) throw error;
      this.logger.warn(`ContactListIndex missing — the client list Scans: ${(error as Error).message}`);
      if (startKey) throw new BadRequestException('Invalid cursor');
      return this.findAll(limit, undefined, filters);
    }
  }

  /** How many contacts `findActive` lists — the index counted when ready, else the Scan. */
  async countActive(filters?: { tagIds?: string[] }): Promise<CountRowsResult> {
    if (!(await this.listIndexReady())) return this.countAll(filters);
    const tags = tagFilter(filters?.tagIds);
    try {
      return await countRows((input) =>
        this.dynamoDb.client.send(
          new QueryCommand({
            ...this.listIndexQuery(tags),
            Select: 'COUNT',
            ...input,
          }),
        ),
      );
    } catch (error) {
      if (!isMissingIndexError(error)) throw error;
      return this.countAll(filters);
    }
  }

  private listIndexQuery(tags: ReturnType<typeof tagFilter>) {
    const filter = tags.expression.replace(/^ AND /, '');
    return {
      TableName: this.tableName,
      IndexName: CONTACTS_GSI2_NAME,
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: { ':pk': CONTACT_LIST_PK, ...tags.values },
      ...(filter && { FilterExpression: filter, ExpressionAttributeNames: tags.names }),
    };
  }

  private async queryListIndex(
    limit: number,
    startKey: Record<string, unknown> | undefined,
    filters?: { tagIds?: string[] },
  ): Promise<PaginatedResult> {
    const tags = tagFilter(filters?.tagIds);
    const query = { ...this.listIndexQuery(tags), ScanIndexForward: true };

    if (!tags.expression) {
      const result = await this.dynamoDb.client.send(
        new QueryCommand({ ...query, Limit: limit, ...(startKey && { ExclusiveStartKey: startKey }) }),
      );
      return {
        items: (result.Items || []).map(this.toContact),
        nextCursor: this.encodeCursor(result.LastEvaluatedKey),
      };
    }

    const keyOf = (i: Record<string, unknown>) => ({ PK: i.PK, SK: i.SK, GSI2PK: i.GSI2PK, GSI2SK: i.GSI2SK });
    const page = await scanPage<Record<string, unknown>>(
      (input) =>
        this.dynamoDb.client.send(
          new QueryCommand({ ...query, ...input, Limit: Math.max(input.Limit, TAGGED_INDEX_READ_ROWS) }),
        ),
      limit,
      { startKey, keyOf },
    );
    // A last read that also ended the partition comes back whole; cut it here too.
    const items = page.items.slice(0, limit);
    const lastKey = page.items.length > limit ? keyOf(items[items.length - 1]) : page.lastKey;
    return { items: items.map(this.toContact), nextCursor: this.encodeCursor(lastKey) };
  }

  /**
   * Whether the ContactListIndex may be read: its readiness row
   * (`CONTACTLISTINDEX / STATE`, stamped by the backfill's `--apply`) exists.
   * Asked again at most once a minute while it does not; once it does, the
   * answer is kept for the life of the process — it only ever flips to ready.
   * A failed read counts as not ready.
   */
  async listIndexReady(now: number = Date.now()): Promise<boolean> {
    const known = this.listIndexReadyState;
    if (known?.ready) return true;
    if (known && now - known.at < LIST_INDEX_READY_RECHECK_MS) return false;
    let ready = false;
    try {
      const res = await this.dynamoDb.client.send(
        new GetCommand({ TableName: this.tableName, Key: { ...CONTACT_LIST_STATE_KEY } }),
      );
      ready = typeof res?.Item?.readyAt === 'string';
    } catch (error) {
      this.logger.warn(`contact list readiness unreadable — treated as not ready: ${(error as Error).message}`);
    }
    this.listIndexReadyState = { ready, at: now };
    return ready;
  }

  /** The same count for one company's contacts — a Query, so the cheap end. */
  async countByCompany(companyId: string, filters?: { tagIds?: string[] }): Promise<CountRowsResult> {
    const tags = tagFilter(filters?.tagIds);
    return countRows((input) =>
      this.dynamoDb.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: CONTACTS_GSI1_NAME,
          KeyConditionExpression: 'GSI1PK = :pk',
          FilterExpression: `#status = :active${tags.expression}`,
          ExpressionAttributeValues: {
            ':pk': `COMPANY#${companyId}`,
            ':active': CrmStatus.ACTIVE,
            ...tags.values,
          },
          ExpressionAttributeNames: { '#status': 'status', ...tags.names },
          Select: 'COUNT',
          ...input,
        }),
      ),
    );
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

    const row = await this.restampListIndex(id, result.Attributes!);
    return this.toContact(row);
  }

  /**
   * The ContactListIndex keys, recomputed from the whole row after a write
   * and written only when they differ — a rename re-files the row, a delete
   * takes it off the list, and a row written before the index existed is
   * filed by its next edit. The write is guarded on the inputs it was
   * computed from; a lost race re-reads the row (consistent) and decides
   * again. Three in a row are left to the backfill's reconcile.
   */
  private async restampListIndex(id: string, row: Record<string, unknown>): Promise<Record<string, unknown>> {
    let current = row;
    for (let attempt = 0; attempt < 3; attempt++) {
      const plan = planContactList(current);
      if (plan.action === 'same') return current;
      try {
        const result = await this.dynamoDb.client.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: { PK: `CONTACT#${id}`, SK: 'METADATA' },
            ...contactListWrite(current, plan),
            ReturnValues: 'ALL_NEW',
          }),
        );
        return result.Attributes ?? current;
      } catch (error) {
        if ((error as Error).name !== 'ConditionalCheckFailedException') throw error;
        const fresh = await this.dynamoDb.client.send(
          new GetCommand({ TableName: this.tableName, Key: { PK: `CONTACT#${id}`, SK: 'METADATA' }, ConsistentRead: true }),
        );
        if (!fresh.Item) return current;
        current = fresh.Item;
      }
    }
    this.logger.warn(`list index of contact ${id} not restamped after 3 attempts`);
    return current;
  }

  /**
   * Whether any contact still holds an answer for a client custom field — a
   * key of its `customFields` map. Reads a page at a time and says "no" only
   * once the table has ended: DynamoDB applies `Limit` before the filter, so
   * `Limit: 1` would answer from a single row. Past `MAX_PAGES` it assumes the
   * field is answered — refusing a delete is the safe way to be wrong.
   */
  async isCustomFieldAnswered(fieldId: string): Promise<boolean> {
    const PAGE = 500;
    const MAX_PAGES = 200;
    let cursor: Record<string, unknown> | undefined;
    let pages = 0;
    do {
      const result = await this.dynamoDb.client.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: 'begins_with(PK, :pk) AND SK = :sk AND attribute_exists(#cf.#field)',
          ExpressionAttributeNames: { '#cf': 'customFields', '#field': fieldId },
          ExpressionAttributeValues: { ':pk': 'CONTACT#', ':sk': 'METADATA' },
          ProjectionExpression: 'PK',
          Limit: PAGE,
          ...(cursor ? { ExclusiveStartKey: cursor } : {}),
        }),
      );
      if ((result.Items?.length ?? 0) > 0) return true;
      cursor = result.LastEvaluatedKey;
      pages += 1;
      if (cursor && pages >= MAX_PAGES) return true;
    } while (cursor);
    return false;
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
      ...(item.billingAddress ? { billingAddress: item.billingAddress as Address } : {}),
      ...(item.lastJobAt ? { lastJobAt: item.lastJobAt as string } : {}),
      ...(Array.isArray(item.tagIds) ? { tagIds: item.tagIds as string[] } : {}),
      ...(item.customFields && typeof item.customFields === 'object' && !Array.isArray(item.customFields)
        ? { customFields: item.customFields as Contact['customFields'] }
        : {}),
      ...(item.sourceId ? { sourceId: item.sourceId as string } : {}),
      ...(item.paymentTerms ? { paymentTerms: item.paymentTerms as Contact['paymentTerms'] } : {}),
      ...(typeof item.customTermsDays === 'number' ? { customTermsDays: item.customTermsDays } : {}),
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
    let key: unknown;
    try {
      key = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
    } catch {
      throw new BadRequestException('Invalid cursor');
    }
    if (typeof key !== 'object' || key === null) throw new BadRequestException('Invalid cursor');
    return key as Record<string, unknown>;
  }
}

/**
 * Workiz's "Filter results" → TAGS: a client carrying ANY of the picked tags
 * (picking a second tag widens the list, as Workiz's does). `tagIds` is a
 * list on the row; DynamoDB's `contains` on a list matches an element. No
 * tags → nothing added, so the untagged list asks exactly what it always did.
 */
function tagFilter(tagIds: string[] | undefined): {
  expression: string;
  names: Record<string, string>;
  values: Record<string, string>;
} {
  if (!tagIds?.length) return { expression: '', names: {}, values: {} };
  const values = Object.fromEntries(tagIds.map((id, i) => [`:tag${i}`, id]));
  const any = Object.keys(values)
    .map((v) => `contains(#tagIds, ${v})`)
    .join(' OR ');
  return { expression: ` AND (${any})`, names: { '#tagIds': 'tagIds' }, values };
}
