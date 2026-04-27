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
