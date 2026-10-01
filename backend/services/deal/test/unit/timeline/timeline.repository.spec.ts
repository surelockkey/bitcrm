import { TimelineRepository } from 'src/timeline/timeline.repository';
import { createMockDynamoDbService, createMockTimelineEntry } from '../mocks';

describe('TimelineRepository', () => {
  let repository: TimelineRepository;
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new TimelineRepository(dynamoDb as any);
  });

  describe('addEntry', () => {
    it('should send PutCommand with correct PK and SK', async () => {
      const entry = createMockTimelineEntry();
      dynamoDb.client.send.mockResolvedValue({});

      await repository.addEntry(entry);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
      const command = dynamoDb.client.send.mock.calls[0][0];
      const item = command.input.Item;
      expect(item.PK).toBe('DEAL#deal-1');
      expect(item.SK).toMatch(/^TIMELINE#/);
      expect(item.SK).toContain(entry.timestamp);
      expect(item.SK).toContain(entry.id);
      expect(item.eventType).toBe('created');
    });

    it('should include all entry fields', async () => {
      const entry = createMockTimelineEntry({ note: 'Test note' });
      dynamoDb.client.send.mockResolvedValue({});

      await repository.addEntry(entry);

      const command = dynamoDb.client.send.mock.calls[0][0];
      const item = command.input.Item;
      expect(item.actorId).toBe(entry.actorId);
      expect(item.actorName).toBe(entry.actorName);
      expect(item.note).toBe('Test note');
    });
  });

  describe('findByDeal', () => {
    it('should query with correct key condition and sort order', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [], Count: 0 });

      await repository.findByDeal('deal-1', 20);

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.KeyConditionExpression).toContain('PK = :pk');
      expect(command.input.KeyConditionExpression).toContain('begins_with(SK, :sk)');
      expect(command.input.ExpressionAttributeValues[':pk']).toBe('DEAL#deal-1');
      expect(command.input.ExpressionAttributeValues[':sk']).toBe('TIMELINE#');
      expect(command.input.ScanIndexForward).toBe(false);
      expect(command.input.Limit).toBe(20);
    });

    it('should return mapped items', async () => {
      const entry = createMockTimelineEntry();
      dynamoDb.client.send.mockResolvedValue({
        Items: [{ PK: 'DEAL#deal-1', SK: 'TIMELINE#ts#id', ...entry }],
        LastEvaluatedKey: null,
      });

      const result = await repository.findByDeal('deal-1', 20);

      expect(result.items.length).toBe(1);
      expect(result.items[0].id).toBe(entry.id);
      expect(result.items[0].eventType).toBe(entry.eventType);
      expect(result.items[0].actorId).toBe(entry.actorId);
      expect(result.nextCursor).toBeUndefined();
    });

    it('should return cursor when more results exist', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Items: [{ ...createMockTimelineEntry(), PK: 'x', SK: 'y' }],
        LastEvaluatedKey: { PK: 'x', SK: 'y' },
      });

      const result = await repository.findByDeal('deal-1', 1);

      expect(result.nextCursor).toBeDefined();
    });

    it('should pass decoded cursor as ExclusiveStartKey', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [] });
      const cursor = Buffer.from(JSON.stringify({ PK: 'a', SK: 'b' })).toString('base64url');

      await repository.findByDeal('deal-1', 20, cursor);

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.ExclusiveStartKey).toEqual({ PK: 'a', SK: 'b' });
    });
  });
});

/**
 * The client card's History: every event of the client's jobs, read off GSI10
 * ContactActivityIndex. A row is in that index only when the writer knew the
 * contact — the key is sparse, so nothing without a contact ever shows up there.
 */
describe('TimelineRepository — contact index', () => {
  let repository: TimelineRepository;
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    dynamoDb.client.send.mockResolvedValue({ Items: [] });
    repository = new TimelineRepository(dynamoDb as any);
  });

  it('stamps GSI10 and keeps contactId on an entry that names its contact', async () => {
    const entry = createMockTimelineEntry({ contactId: 'contact-1' });
    await repository.addEntry(entry);
    const item = dynamoDb.client.send.mock.calls[0][0].input.Item;
    expect(item.GSI10PK).toBe('CONTACT#contact-1');
    expect(item.GSI10SK).toBe(`${entry.timestamp}#${entry.id}`);
    expect(item.contactId).toBe('contact-1');
  });

  it('writes no GSI10 keys when the contact is unknown (sparse index)', async () => {
    await repository.addEntry(createMockTimelineEntry());
    const item = dynamoDb.client.send.mock.calls[0][0].input.Item;
    expect(item).not.toHaveProperty('GSI10PK');
    expect(item).not.toHaveProperty('GSI10SK');
  });

  it('findByContact queries ContactActivityIndex newest first with the limit and cursor', async () => {
    const cursor = Buffer.from(JSON.stringify({ PK: 'a', SK: 'b' })).toString('base64url');
    await repository.findByContact('contact-1', 30, cursor);
    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.IndexName).toBe('ContactActivityIndex');
    expect(input.KeyConditionExpression).toBe('GSI10PK = :pk');
    expect(input.ExpressionAttributeValues).toEqual({ ':pk': 'CONTACT#contact-1' });
    expect(input.ScanIndexForward).toBe(false);
    expect(input.Limit).toBe(30);
    expect(input.ExclusiveStartKey).toEqual({ PK: 'a', SK: 'b' });
  });

  it('findByContact maps rows, contactId included, and hands back a cursor', async () => {
    const entry = createMockTimelineEntry({ contactId: 'contact-1' });
    dynamoDb.client.send.mockResolvedValue({
      Items: [{ PK: 'DEAL#deal-1', SK: 'TIMELINE#x', GSI10PK: 'CONTACT#contact-1', ...entry }],
      LastEvaluatedKey: { PK: 'DEAL#deal-1', SK: 'TIMELINE#x', GSI10PK: 'CONTACT#contact-1', GSI10SK: 'x' },
    });
    const result = await repository.findByContact('contact-1', 30);
    expect(result.items).toEqual([entry]);
    expect(result.nextCursor).toBeDefined();
  });

  it('findClientActivity reads the import’s CLIENT#<id> / ACT# rows newest first', async () => {
    dynamoDb.client.send.mockResolvedValue({
      Items: [
        {
          PK: 'CLIENT#contact-1',
          SK: 'ACT#2020-03-04T13:37:00.600Z#ab40',
          id: 'ab40',
          eventType: 'workiz_activity',
          actorId: 'workiz:unresolved',
          actorName: 'User A',
          timestamp: '2020-03-04T13:37:00.600Z',
          note: 'Created client',
          details: { kind: 'client_created', source: 'workiz' },
        },
      ],
    });
    const rows = await repository.findClientActivity('contact-1');
    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.KeyConditionExpression).toBe('PK = :pk AND begins_with(SK, :sk)');
    expect(input.ExpressionAttributeValues).toEqual({ ':pk': 'CLIENT#contact-1', ':sk': 'ACT#' });
    expect(input.ScanIndexForward).toBe(false);
    expect(input).not.toHaveProperty('IndexName');
    expect(rows).toEqual([
      expect.objectContaining({ id: 'ab40', eventType: 'workiz_activity', note: 'Created client', timestamp: '2020-03-04T13:37:00.600Z' }),
    ]);
    // An import row has no job; it must not pretend to.
    expect(rows[0].dealId).toBeUndefined();
  });
});
