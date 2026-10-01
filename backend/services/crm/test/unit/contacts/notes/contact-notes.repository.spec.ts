import { Test } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { type ContactNote } from '@bitcrm/types';
import { ContactNotesRepository } from 'src/contacts/notes/contact-notes.repository';
import { createMockDynamoDbService } from '../../mocks';

const note = (overrides: Partial<ContactNote> = {}): ContactNote => ({
  id: 'note-1',
  contactId: 'contact-1',
  note: 'Gate code 1234',
  actorId: 'admin-1',
  actorName: 'admin@test.com',
  pinned: false,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  ...overrides,
});

const row = (n: ContactNote) => ({
  PK: `CONTACT#${n.contactId}`,
  SK: `NOTE#${n.createdAt}#${n.id}`,
  ...n,
});

describe('ContactNotesRepository', () => {
  let repository: ContactNotesRepository;
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  const sentInput = (i = 0) => dynamoDb.client.send.mock.calls[i][0].input;

  beforeEach(async () => {
    dynamoDb = createMockDynamoDbService();
    const module = await Test.createTestingModule({
      providers: [ContactNotesRepository, { provide: DynamoDbService, useValue: dynamoDb }],
    }).compile();
    repository = module.get(ContactNotesRepository);
  });

  describe('create', () => {
    it('writes the note under the contact with a date-sorted NOTE# sort key, once', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      await repository.create(note());

      const input = sentInput();
      expect(input.Item).toMatchObject({
        PK: 'CONTACT#contact-1',
        SK: 'NOTE#2026-10-01T10:00:00.000Z#note-1',
        id: 'note-1',
        note: 'Gate code 1234',
        pinned: false,
      });
      expect(input.ConditionExpression).toBe('attribute_not_exists(SK)');
    });
  });

  describe('list', () => {
    it('queries the NOTE# rows of the contact newest first, with the page size and cursor', async () => {
      const n = note();
      dynamoDb.client.send.mockResolvedValue({ Items: [row(n)], LastEvaluatedKey: undefined });

      const result = await repository.list('contact-1', 20);

      const input = sentInput();
      expect(input.KeyConditionExpression).toBe('PK = :pk AND begins_with(SK, :sk)');
      expect(input.ExpressionAttributeValues).toEqual({ ':pk': 'CONTACT#contact-1', ':sk': 'NOTE#' });
      expect(input.ScanIndexForward).toBe(false);
      expect(input.Limit).toBe(20);
      expect(input.ExclusiveStartKey).toBeUndefined();
      expect(result.items).toEqual([n]);
      expect(result.nextCursor).toBeUndefined();
    });

    it('hands back an opaque cursor that resumes where the page stopped', async () => {
      const lastKey = { PK: 'CONTACT#contact-1', SK: 'NOTE#2026-10-01T10:00:00.000Z#note-1' };
      dynamoDb.client.send.mockResolvedValueOnce({ Items: [row(note())], LastEvaluatedKey: lastKey });
      dynamoDb.client.send.mockResolvedValueOnce({ Items: [] });

      const first = await repository.list('contact-1', 1);
      expect(first.nextCursor).toEqual(expect.any(String));

      await repository.list('contact-1', 1, first.nextCursor);
      expect(sentInput(1).ExclusiveStartKey).toEqual(lastKey);
    });

    it('does not let a stray row attribute leak PK/SK into the note', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [row(note({ source: 'workiz', externalId: 'wz-9' }))] });

      const { items } = await repository.list('contact-1', 20);

      expect(items[0]).toEqual(note({ source: 'workiz', externalId: 'wz-9' }));
      expect(items[0]).not.toHaveProperty('PK');
    });
  });

  describe('listPinned', () => {
    it('walks every page of the partition keeping only pinned rows', async () => {
      const pinned = note({ id: 'note-p', pinned: true, createdAt: '2026-09-01T00:00:00.000Z' });
      dynamoDb.client.send
        .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { PK: 'x', SK: 'y' } })
        .mockResolvedValueOnce({ Items: [row(pinned)] });

      const result = await repository.listPinned('contact-1');

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
      expect(sentInput(0).FilterExpression).toBe('pinned = :pinned');
      expect(sentInput(0).ExpressionAttributeValues[':pinned']).toBe(true);
      expect(sentInput(0).ScanIndexForward).toBe(false);
      expect(sentInput(1).ExclusiveStartKey).toEqual({ PK: 'x', SK: 'y' });
      expect(result).toEqual([pinned]);
    });
  });

  describe('findById', () => {
    it('finds a note by id inside the contact partition, across pages', async () => {
      const wanted = note({ id: 'note-2', createdAt: '2026-09-30T00:00:00.000Z' });
      dynamoDb.client.send
        .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { PK: 'x', SK: 'y' } })
        .mockResolvedValueOnce({ Items: [row(wanted)] });

      const result = await repository.findById('contact-1', 'note-2');

      expect(sentInput(0).KeyConditionExpression).toBe('PK = :pk AND begins_with(SK, :sk)');
      expect(sentInput(0).FilterExpression).toBe('id = :id');
      expect(sentInput(0).ExpressionAttributeValues[':id']).toBe('note-2');
      expect(result).toEqual(wanted);
    });

    it('answers null when the partition has no such note', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [] });

      expect(await repository.findById('contact-1', 'missing')).toBeNull();
    });
  });

  describe('count', () => {
    it('counts the NOTE# rows without reading bodies, summing pages', async () => {
      dynamoDb.client.send
        .mockResolvedValueOnce({ Count: 3, LastEvaluatedKey: { PK: 'x', SK: 'y' } })
        .mockResolvedValueOnce({ Count: 2 });

      expect(await repository.count('contact-1')).toBe(5);
      expect(sentInput(0).Select).toBe('COUNT');
      expect(sentInput(0).KeyConditionExpression).toBe('PK = :pk AND begins_with(SK, :sk)');
    });
  });

  describe('update', () => {
    it('sets only the fields given plus updatedAt, on the exact key, and returns the new row', async () => {
      const existing = note();
      dynamoDb.client.send.mockResolvedValue({
        Attributes: row({ ...existing, pinned: true, updatedAt: '2026-10-02T00:00:00.000Z' }),
      });

      const result = await repository.update(existing, { pinned: true });

      const input = sentInput();
      expect(input.Key).toEqual({ PK: 'CONTACT#contact-1', SK: 'NOTE#2026-10-01T10:00:00.000Z#note-1' });
      expect(input.UpdateExpression).toBe('SET #pinned = :pinned, #updatedAt = :updatedAt');
      expect(input.ExpressionAttributeValues[':pinned']).toBe(true);
      expect(input.ConditionExpression).toBe('attribute_exists(PK)');
      expect(input.ReturnValues).toBe('ALL_NEW');
      expect(result.pinned).toBe(true);
      expect(result).not.toHaveProperty('PK');
    });

    it('can change the text and the pin together', async () => {
      const existing = note();
      dynamoDb.client.send.mockResolvedValue({ Attributes: row({ ...existing, note: 'New', pinned: true }) });

      await repository.update(existing, { note: 'New', pinned: true });

      expect(sentInput().UpdateExpression).toBe('SET #note = :note, #pinned = :pinned, #updatedAt = :updatedAt');
    });
  });

  describe('delete', () => {
    it('deletes the exact row', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      await repository.delete(note());

      expect(sentInput().Key).toEqual({ PK: 'CONTACT#contact-1', SK: 'NOTE#2026-10-01T10:00:00.000Z#note-1' });
    });
  });

  describe('moveAll', () => {
    it("re-keys every note of the duplicate under the primary in one transaction per batch", async () => {
      const a = note({ id: 'n-a', contactId: 'contact-2', createdAt: '2026-09-01T00:00:00.000Z' });
      const b = note({ id: 'n-b', contactId: 'contact-2', createdAt: '2026-09-02T00:00:00.000Z', pinned: true });
      dynamoDb.client.send
        .mockResolvedValueOnce({ Items: [row(a), row(b)] }) // the walk
        .mockResolvedValueOnce({}); // the transaction

      const moved = await repository.moveAll('contact-2', 'contact-1');

      expect(moved).toBe(2);
      const tx = sentInput(1).TransactItems;
      expect(tx).toHaveLength(4);
      expect(tx[0].Put.Item).toMatchObject({
        PK: 'CONTACT#contact-1',
        SK: 'NOTE#2026-09-01T00:00:00.000Z#n-a',
        contactId: 'contact-1',
        id: 'n-a',
        note: a.note,
      });
      expect(tx[1].Delete.Key).toEqual({ PK: 'CONTACT#contact-2', SK: 'NOTE#2026-09-01T00:00:00.000Z#n-a' });
      expect(tx[2].Put.Item).toMatchObject({ PK: 'CONTACT#contact-1', pinned: true });
      expect(tx[3].Delete.Key).toEqual({ PK: 'CONTACT#contact-2', SK: 'NOTE#2026-09-02T00:00:00.000Z#n-b' });
    });

    it('splits a long list into transactions of at most 25 notes (50 operations)', async () => {
      const rows = Array.from({ length: 30 }, (_, i) =>
        row(note({ id: `n-${i}`, contactId: 'contact-2', createdAt: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` })),
      );
      dynamoDb.client.send
        .mockResolvedValueOnce({ Items: rows })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      const moved = await repository.moveAll('contact-2', 'contact-1');

      expect(moved).toBe(30);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(3);
      expect(sentInput(1).TransactItems).toHaveLength(50);
      expect(sentInput(2).TransactItems).toHaveLength(10);
    });

    it('does nothing when the duplicate has no notes', async () => {
      dynamoDb.client.send.mockResolvedValueOnce({ Items: [] });

      expect(await repository.moveAll('contact-2', 'contact-1')).toBe(0);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
    });
  });
});
