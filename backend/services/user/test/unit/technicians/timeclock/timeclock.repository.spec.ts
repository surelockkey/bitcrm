import { type TimeClockEntry } from '@bitcrm/types';
import {
  ClockAlreadyClosedError,
  ClockAlreadyOpenError,
  TimeClockRepository,
} from '../../../../src/technicians/timeclock/timeclock.repository';
import { createMockDynamoDbClient } from '../../mocks';

function entry(over?: Partial<TimeClockEntry>): TimeClockEntry {
  return {
    id: 'tc-1',
    userId: 'tech-1',
    startedAt: '2026-09-17T08:00:00.000Z',
    source: 'mobile',
    createdAt: '2026-09-17T08:00:00.000Z',
    updatedAt: '2026-09-17T08:00:00.000Z',
    ...over,
  };
}

/** The shape DynamoDB returns for a cancelled transaction. */
function transactionConflict() {
  return Object.assign(new Error('Transaction cancelled'), {
    name: 'TransactionCanceledException',
    CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }],
  });
}

describe('TimeClockRepository (unit)', () => {
  let client: ReturnType<typeof createMockDynamoDbClient>;
  let repo: TimeClockRepository;

  beforeEach(() => {
    client = createMockDynamoDbClient();
    repo = new TimeClockRepository({ client } as never);
  });

  describe('createOpen', () => {
    it('writes the history item under the user’s own partition, keyed by start instant', async () => {
      client.send.mockResolvedValue({});
      await repo.createOpen(entry());

      const items = client.send.mock.calls[0][0].input.TransactItems;
      expect(items[0].Put.Item.PK).toBe('USER#tech-1');
      expect(items[0].Put.Item.SK).toBe('CLOCK#2026-09-17T08:00:00.000Z#tc-1');
    });

    // One item per user IS the "only one running clock" rule — enforced by the
    // key, not by a read-then-write the second phone can slip through.
    it('claims the single open slot conditionally, in the same transaction', async () => {
      client.send.mockResolvedValue({});
      await repo.createOpen(entry());

      const items = client.send.mock.calls[0][0].input.TransactItems;
      expect(items).toHaveLength(2);
      expect(items[1].Put.Item.SK).toBe('CLOCK_OPEN');
      expect(items[1].Put.ConditionExpression).toBe('attribute_not_exists(SK)');
    });

    it('translates a rejected claim into ClockAlreadyOpenError', async () => {
      client.send.mockRejectedValue(transactionConflict());
      await expect(repo.createOpen(entry())).rejects.toBeInstanceOf(ClockAlreadyOpenError);
    });

    it('lets an unrelated failure through untouched', async () => {
      client.send.mockRejectedValue(
        Object.assign(new Error('boom'), { name: 'ProvisionedThroughputExceededException' }),
      );
      await expect(repo.createOpen(entry())).rejects.toThrow('boom');
    });
  });

  describe('getOpen', () => {
    it('reads the open slot with a single GetItem', async () => {
      client.send.mockResolvedValue({ Item: entry() });
      const open = await repo.getOpen('tech-1');

      expect(client.send.mock.calls[0][0].input.Key).toEqual({
        PK: 'USER#tech-1',
        SK: 'CLOCK_OPEN',
      });
      expect(open?.id).toBe('tc-1');
    });

    it('returns null when nobody is clocked in', async () => {
      client.send.mockResolvedValue({});
      expect(await repo.getOpen('tech-1')).toBeNull();
    });
  });

  describe('close', () => {
    it('stamps the history item and releases the slot together', async () => {
      client.send.mockResolvedValue({});
      await repo.close(entry(), { endedAt: '2026-09-17T16:00:00.000Z', minutes: 480 });

      const items = client.send.mock.calls[0][0].input.TransactItems;
      expect(items[0].Update.Key.SK).toBe('CLOCK#2026-09-17T08:00:00.000Z#tc-1');
      expect(items[0].Update.ExpressionAttributeValues[':m']).toBe(480);
      expect(items[1].Delete.Key.SK).toBe('CLOCK_OPEN');
    });

    // Two stops racing must close the shift once. The delete is conditional on
    // the slot still holding THIS entry.
    it('releases the slot only if it still holds this entry', async () => {
      client.send.mockResolvedValue({});
      await repo.close(entry(), { endedAt: '2026-09-17T16:00:00.000Z', minutes: 480 });

      const del = client.send.mock.calls[0][0].input.TransactItems[1].Delete;
      expect(del.ConditionExpression).toBe('#id = :id');
      expect(del.ExpressionAttributeValues).toEqual({ ':id': 'tc-1' });
    });

    it('writes the end location when there is one, and leaves the start untouched', async () => {
      client.send.mockResolvedValue({});
      const open = entry({ startLocation: { lat: 33.749, lng: -84.388, accuracy: 10 } });
      const closed = await repo.close(open, {
        endedAt: '2026-09-17T16:00:00.000Z',
        minutes: 480,
        endLocation: { lat: 33.8, lng: -84.4 },
      });

      const update = client.send.mock.calls[0][0].input.TransactItems[0].Update;
      expect(update.UpdateExpression).toContain('endLocation = :loc');
      expect(update.UpdateExpression).not.toContain('startLocation');
      expect(closed.startLocation).toEqual({ lat: 33.749, lng: -84.388, accuracy: 10 });
    });

    // The slot has already been released by whoever won, so the conditional
    // Delete fails and DynamoDB cancels the whole transaction. That is a second
    // tap on a doorstep, not a server fault, and the caller has to be able to
    // tell the two apart.
    it('names the loser of a stop race instead of leaking the cancellation', async () => {
      client.send.mockRejectedValue(transactionConflict());

      await expect(
        repo.close(entry(), { endedAt: '2026-09-17T16:00:00.000Z', minutes: 480 }),
      ).rejects.toBeInstanceOf(ClockAlreadyClosedError);
    });

    it('lets an unrelated failure through untouched', async () => {
      client.send.mockRejectedValue(
        Object.assign(new Error('boom'), { name: 'ProvisionedThroughputExceededException' }),
      );

      await expect(
        repo.close(entry(), { endedAt: '2026-09-17T16:00:00.000Z', minutes: 480 }),
      ).rejects.toThrow('boom');
    });

    it('omits the end location entirely when the technician shared none', async () => {
      client.send.mockResolvedValue({});
      const closed = await repo.close(entry(), {
        endedAt: '2026-09-17T16:00:00.000Z',
        minutes: 480,
      });

      const update = client.send.mock.calls[0][0].input.TransactItems[0].Update;
      expect(update.UpdateExpression).not.toContain('endLocation');
      expect(closed).not.toHaveProperty('endLocation');
    });
  });

  describe('listByUserInRange', () => {
    it('queries the CLOCK# slice between the day boundaries', async () => {
      client.send.mockResolvedValue({ Items: [entry()] });
      await repo.listByUserInRange('tech-1', '2026-09-17', '2026-09-17');

      const input = client.send.mock.calls[0][0].input;
      expect(input.KeyConditionExpression).toBe('PK = :pk AND SK BETWEEN :lo AND :hi');
      expect(input.ExpressionAttributeValues[':lo']).toBe('CLOCK#2026-09-17T00:00:00.000Z');
      expect(input.ExpressionAttributeValues[':hi']).toBe('CLOCK#2026-09-17T23:59:59.999Z~');
      expect(input.IndexName).toBeUndefined();
    });

    // A two-week payroll period for a busy technician can exceed one page, and
    // a half-read timesheet is a short paycheck.
    it('follows pagination to the end', async () => {
      client.send
        .mockResolvedValueOnce({ Items: [entry({ id: 'tc-1' })], LastEvaluatedKey: { PK: 'x' } })
        .mockResolvedValueOnce({ Items: [entry({ id: 'tc-2' })] });

      const entries = await repo.listByUserInRange('tech-1', '2026-09-01', '2026-09-15');

      expect(entries.map((e) => e.id)).toEqual(['tc-1', 'tc-2']);
      expect(client.send).toHaveBeenCalledTimes(2);
    });
  });
});
