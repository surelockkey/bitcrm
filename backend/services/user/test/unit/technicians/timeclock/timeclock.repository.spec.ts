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

  describe('createOpen — the Timesheets report index', () => {
    // The report reads everyone's entries of a month off GSI6 instead of a Scan.
    it('puts the history item in TimeClockIndex under the account month it started in', async () => {
      client.send.mockResolvedValue({});
      await repo.createOpen(entry());

      const item = client.send.mock.calls[0][0].input.TransactItems[0].Put.Item;
      expect(item.GSI6PK).toBe('TIMECLOCK#2026-09');
      expect(item.GSI6SK).toBe('2026-09-17T08:00:00.000Z#tc-1');
    });

    // 02:30 UTC on 1 October is still 30 September in New York.
    it('files a late-evening Eastern start under the Eastern month, not the UTC one', async () => {
      client.send.mockResolvedValue({});
      await repo.createOpen(entry({ startedAt: '2026-10-01T02:30:00.000Z' }));

      const item = client.send.mock.calls[0][0].input.TransactItems[0].Put.Item;
      expect(item.GSI6PK).toBe('TIMECLOCK#2026-09');
    });

    // The slot carries the whole running entry; were it indexed too, a running
    // shift would be listed twice.
    it('never indexes the open slot', async () => {
      client.send.mockResolvedValue({});
      await repo.createOpen(entry());

      const slot = client.send.mock.calls[0][0].input.TransactItems[1].Put.Item;
      expect(slot.SK).toBe('CLOCK_OPEN');
      expect(slot.GSI6PK).toBeUndefined();
      expect(slot.GSI6SK).toBeUndefined();
    });
  });

  describe('getLaborRate', () => {
    it('reads laborCostPerHour off the technician profile', async () => {
      client.send.mockResolvedValue({ Item: { laborCostPerHour: 40 } });
      expect(await repo.getLaborRate('tech-1')).toBe(40);
      expect(client.send.mock.calls[0][0].input.Key).toEqual({ PK: 'USER#tech-1', SK: 'TECH_PROFILE' });
    });

    it.each([[undefined], [{}], [{ laborCostPerHour: 0 }], [{ laborCostPerHour: 'x' }]])(
      'has no rate for %p',
      async (item) => {
        client.send.mockResolvedValue({ Item: item });
        expect(await repo.getLaborRate('tech-1')).toBeNull();
      },
    );
  });

  describe('listStartedBetween', () => {
    it('queries one month partition of TimeClockIndex between two instants, to the last page', async () => {
      client.send
        .mockResolvedValueOnce({ Items: [entry()], LastEvaluatedKey: { k: 1 } })
        .mockResolvedValueOnce({ Items: [entry({ id: 'tc-2' })] });

      const out = await repo.listStartedBetween('2026-09', '2026-09-01T04:00:00.000Z', '2026-09-28T04:00:00.000Z');

      const input = client.send.mock.calls[0][0].input;
      expect(input.IndexName).toBe('TimeClockIndex');
      expect(input.KeyConditionExpression).toBe('GSI6PK = :pk AND GSI6SK BETWEEN :lo AND :hi');
      expect(input.ExpressionAttributeValues).toEqual({
        ':pk': 'TIMECLOCK#2026-09',
        ':lo': '2026-09-01T04:00:00.000Z',
        ':hi': '2026-09-28T04:00:00.000Z',
      });
      expect(client.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ k: 1 });
      expect(out.map((e) => e.id)).toEqual(['tc-1', 'tc-2']);
    });

    it('reads the rate, the note and the import id back', async () => {
      client.send.mockResolvedValue({
        Items: [{ ...entry(), laborCostPerHour: 25, notes: 'Forgot to clock out', externalId: 'workiz:timeclock:1' }],
      });
      const [e] = await repo.listStartedBetween('2026-09', 'a', 'b');
      expect(e.laborCostPerHour).toBe(25);
      expect(e.notes).toBe('Forgot to clock out');
      expect(e.externalId).toBe('workiz:timeclock:1');
    });
  });

  describe('peopleByIds / openUserIds', () => {
    it('batch-reads the METADATA of each person once', async () => {
      client.send.mockResolvedValue({
        Responses: { BitCRM_Users: [{ id: 'u1', firstName: 'Yeter', lastName: 'Mizrahi' }] },
      });
      const people = await repo.peopleByIds(['u1', 'u1', 'u2']);

      const req = client.send.mock.calls[0][0].input.RequestItems.BitCRM_Users;
      expect(req.Keys).toEqual([
        { PK: 'USER#u1', SK: 'METADATA' },
        { PK: 'USER#u2', SK: 'METADATA' },
      ]);
      expect(Object.values(req.ExpressionAttributeNames)).toEqual(['id', 'firstName', 'lastName', 'email']);
      expect(people.get('u1')).toMatchObject({ firstName: 'Yeter', lastName: 'Mizrahi' });
      expect(people.has('u2')).toBe(false);
    });

    it('asks again for keys DynamoDB left unprocessed', async () => {
      client.send
        .mockResolvedValueOnce({
          Responses: { BitCRM_Users: [{ PK: 'USER#u1' }] },
          UnprocessedKeys: { BitCRM_Users: { Keys: [{ PK: 'USER#u2', SK: 'CLOCK_OPEN' }] } },
        })
        .mockResolvedValueOnce({ Responses: { BitCRM_Users: [{ PK: 'USER#u2' }] } });

      const open = await repo.openUserIds(['u1', 'u2', 'u3']);
      expect(client.send.mock.calls[1][0].input.RequestItems.BitCRM_Users.Keys).toEqual([
        { PK: 'USER#u2', SK: 'CLOCK_OPEN' },
      ]);
      expect([...open].sort()).toEqual(['u1', 'u2']);
    });

    it('splits more than 100 keys into several calls', async () => {
      client.send.mockResolvedValue({ Responses: { BitCRM_Users: [] } });
      await repo.openUserIds(Array.from({ length: 150 }, (_, i) => `u${i}`));
      expect(client.send).toHaveBeenCalledTimes(2);
      expect(client.send.mock.calls[0][0].input.RequestItems.BitCRM_Users.Keys).toHaveLength(100);
    });

    it('makes no call for nobody', async () => {
      expect((await repo.peopleByIds([])).size).toBe(0);
      expect(client.send).not.toHaveBeenCalled();
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
