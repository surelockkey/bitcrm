import { Injectable } from '@nestjs/common';
import {
  DeleteCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type ContactNote } from '@bitcrm/types';
import {
  CONTACTS_TABLE,
  CONTACT_NOTE_SK_PREFIX,
  contactNoteSk,
} from '../../common/constants/dynamo.constants';

export interface ContactNotesPage {
  items: ContactNote[];
  nextCursor?: string;
}

/** DynamoDB caps a TransactWrite at 100 operations; a move is two per note. */
const MOVE_BATCH_NOTES = 25;

/**
 * Client notes, in the contacts table.
 *
 *   CONTACT#<contactId> / NOTE#<createdAt>#<noteId>   one note; `pinned` is a plain attribute
 *
 * The feed is a reverse Query on the partition (`begins_with(SK, 'NOTE#')`,
 * `ScanIndexForward: false`), paged with the usual opaque cursor. Pinned notes
 * are found by a second Query over the same partition filtered on
 * `pinned = true` — walked to the end, which is cheap because a client holds
 * tens of notes, not thousands, and simpler than a sparse marker row that
 * every pin/unpin and every merge would have to keep in step. The same goes
 * for `findById`: the route names a note by id alone, and the sort key also
 * carries its createdAt, so the id is found by filtering the partition rather
 * than kept in a pointer row.
 *
 * No GSI keys are written, so the CompanyIndex never sees a note; the contact
 * list's Scan pins `SK = METADATA` for the same reason.
 */
@Injectable()
export class ContactNotesRepository {
  private readonly tableName = CONTACTS_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  async create(note: ContactNote): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { ...this.key(note), ...note },
        ConditionExpression: 'attribute_not_exists(SK)',
      }),
    );
  }

  /** One page of the feed, newest first. Pinned notes are in here too — the service lifts them. */
  async list(contactId: string, limit: number, cursor?: string): Promise<ContactNotesPage> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `CONTACT#${contactId}`,
          ':sk': CONTACT_NOTE_SK_PREFIX,
        },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );
    return {
      items: (result.Items || []).map(this.toNote),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  /** Every pinned note of the client, newest first — the whole partition is walked. */
  async listPinned(contactId: string): Promise<ContactNote[]> {
    const out: ContactNote[] = [];
    await this.walk(contactId, {
      FilterExpression: 'pinned = :pinned',
      ExpressionAttributeValues: { ':pinned': true },
    }, (items) => { out.push(...items.map(this.toNote)); });
    return out;
  }

  async findById(contactId: string, noteId: string): Promise<ContactNote | null> {
    let found: ContactNote | null = null;
    await this.walk(contactId, {
      FilterExpression: 'id = :id',
      ExpressionAttributeValues: { ':id': noteId },
    }, (items) => {
      if (items.length) found = this.toNote(items[0]);
      return found === null; // keep going until found
    });
    return found;
  }

  /** How many notes the client has — the number on the rail's Notes badge. */
  async count(contactId: string): Promise<number> {
    let total = 0;
    let key: Record<string, unknown> | undefined;
    do {
      const result = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `CONTACT#${contactId}`,
            ':sk': CONTACT_NOTE_SK_PREFIX,
          },
          Select: 'COUNT',
          ExclusiveStartKey: key,
        }),
      );
      total += result.Count ?? 0;
      key = result.LastEvaluatedKey;
    } while (key);
    return total;
  }

  async update(
    existing: ContactNote,
    attrs: { note?: string; pinned?: boolean },
  ): Promise<ContactNote> {
    const setParts: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const changes: Record<string, unknown> = {
      ...(attrs.note !== undefined && { note: attrs.note }),
      ...(attrs.pinned !== undefined && { pinned: attrs.pinned }),
      updatedAt: new Date().toISOString(),
    };
    for (const [field, value] of Object.entries(changes)) {
      names[`#${field}`] = field;
      values[`:${field}`] = value;
      setParts.push(`#${field} = :${field}`);
    }

    const result = await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: this.key(existing),
        UpdateExpression: `SET ${setParts.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );
    return this.toNote(result.Attributes!);
  }

  async delete(existing: ContactNote): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({ TableName: this.tableName, Key: this.key(existing) }),
    );
  }

  /**
   * Re-key every note of `fromContactId` under `toContactId` (a merge). Each
   * note is a Put under the new partition plus a Delete of the old row, in
   * one transaction per batch, so a note is never in both places or neither.
   * Returns how many moved.
   */
  async moveAll(fromContactId: string, toContactId: string): Promise<number> {
    const notes: ContactNote[] = [];
    await this.walk(fromContactId, {}, (items) => { notes.push(...items.map(this.toNote)); });

    for (let i = 0; i < notes.length; i += MOVE_BATCH_NOTES) {
      const batch = notes.slice(i, i + MOVE_BATCH_NOTES);
      await this.dynamoDb.client.send(
        new TransactWriteCommand({
          TransactItems: batch.flatMap((note) => {
            const moved: ContactNote = { ...note, contactId: toContactId };
            return [
              { Put: { TableName: this.tableName, Item: { ...this.key(moved), ...moved } } },
              { Delete: { TableName: this.tableName, Key: this.key(note) } },
            ];
          }),
        }),
      );
    }
    return notes.length;
  }

  /**
   * Walk the NOTE# rows of a contact newest first, page by page, handing each
   * page to `onPage`; returning `false` stops the walk.
   */
  private async walk(
    contactId: string,
    extra: { FilterExpression?: string; ExpressionAttributeValues?: Record<string, unknown> },
    onPage: (items: Record<string, unknown>[]) => boolean | void,
  ): Promise<void> {
    let key: Record<string, unknown> | undefined;
    do {
      const result = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `CONTACT#${contactId}`,
            ':sk': CONTACT_NOTE_SK_PREFIX,
            ...extra.ExpressionAttributeValues,
          },
          ...(extra.FilterExpression && { FilterExpression: extra.FilterExpression }),
          ScanIndexForward: false,
          ExclusiveStartKey: key,
        }),
      );
      if (onPage((result.Items || []) as Record<string, unknown>[]) === false) return;
      key = result.LastEvaluatedKey;
    } while (key);
  }

  private key(note: Pick<ContactNote, 'contactId' | 'createdAt' | 'id'>) {
    return { PK: `CONTACT#${note.contactId}`, SK: contactNoteSk(note.createdAt, note.id) };
  }

  /** A read whitelist: the row's PK/SK and anything else stay behind. */
  private toNote = (item: Record<string, unknown>): ContactNote => ({
    id: item.id as string,
    contactId: item.contactId as string,
    note: item.note as string,
    actorId: item.actorId as string,
    actorName: item.actorName as string,
    pinned: item.pinned === true,
    createdAt: item.createdAt as string,
    updatedAt: item.updatedAt as string,
    ...(item.source === 'workiz' && { source: 'workiz' as const }),
    ...(typeof item.externalId === 'string' && { externalId: item.externalId }),
  });

  private encodeCursor(lastEvaluatedKey?: Record<string, unknown>): string | undefined {
    if (!lastEvaluatedKey) return undefined;
    return Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64url');
  }

  private decodeCursor(cursor?: string): Record<string, unknown> | undefined {
    if (!cursor) return undefined;
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
  }
}
