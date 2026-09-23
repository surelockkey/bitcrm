/**
 * GSI5 StatusScheduleIndex (web-deals-scale design, step 2): the visit date
 * becomes a key, so the jobs list, the board and the schedule read a window
 * instead of the whole table.
 *
 *   GSI5PK = STATUS#<superStatus>
 *   GSI5SK = <scheduledDate | UNSCHED>#<slotStart | ~>#DEAL#<id>
 *
 * `slotStart` is the first five characters of `scheduledTimeSlot`; an
 * all-day or slotless visit sorts after the timed ones under `~`. The
 * Workiz importer writes the very same key.
 */
import { JobSuperStatus } from '@bitcrm/types';
import {
  DealsRepository,
  statusScheduleKeys,
} from '../../../src/deals/deals.repository';
import { createMockDeal, createMockDynamoDbService } from '../mocks';

describe('statusScheduleKeys', () => {
  it('a timed visit keys on date and slot start', () => {
    expect(
      statusScheduleKeys({
        id: 'd1',
        superStatus: JobSuperStatus.SUBMITTED,
        scheduledDate: '2026-09-23',
        scheduledTimeSlot: '09:30-11:00',
      }),
    ).toEqual({
      GSI5PK: 'STATUS#submitted',
      GSI5SK: '2026-09-23#09:30#DEAL#d1',
      slotStart: '09:30',
    });
  });

  it('an all-day visit sorts after the timed ones under ~ and carries no slotStart', () => {
    expect(
      statusScheduleKeys({
        id: 'd1',
        superStatus: JobSuperStatus.DONE,
        scheduledDate: '2026-09-23',
        scheduledTimeSlot: '09:30-11:00',
        allDay: true,
      }),
    ).toEqual({ GSI5PK: 'STATUS#done', GSI5SK: '2026-09-23#~#DEAL#d1', slotStart: undefined });
  });

  it('no date reads UNSCHED, which sorts after every date', () => {
    const keys = statusScheduleKeys({ id: 'd1', superStatus: JobSuperStatus.PENDING });
    expect(keys.GSI5SK).toBe('UNSCHED#~#DEAL#d1');
    expect('UNSCHED#' > '2099-12-31#').toBe(true);
  });
});

describe('DealsRepository — writing the schedule index', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: DealsRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new DealsRepository(dynamoDb as any);
  });

  it('create() writes GSI5 keys and slotStart next to the other index keys', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repository.create(
      createMockDeal({ id: 'd1', superStatus: JobSuperStatus.SUBMITTED, scheduledDate: '2026-09-23', scheduledTimeSlot: '14:00-16:00' }),
    );
    const item = dynamoDb.client.send.mock.calls[0][0].input.Item;
    expect(item.GSI5PK).toBe('STATUS#submitted');
    expect(item.GSI5SK).toBe('2026-09-23#14:00#DEAL#d1');
    expect(item.slotStart).toBe('14:00');
  });

  it('update() of a scheduling field restamps GSI5 from the row as it is after the write', async () => {
    const after = {
      ...createMockDeal({ id: 'd1', superStatus: JobSuperStatus.PENDING, scheduledTimeSlot: '08:00-09:00' }),
      PK: 'DEAL#d1',
      SK: 'METADATA',
      scheduledDate: '2026-10-01',
    };
    dynamoDb.client.send
      .mockResolvedValueOnce({ Attributes: after })
      .mockResolvedValueOnce({ Attributes: { ...after, GSI5PK: 'STATUS#pending', GSI5SK: '2026-10-01#08:00#DEAL#d1' } });

    const deal = await repository.update('d1', { scheduledDate: '2026-10-01' });

    expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
    const restamp = dynamoDb.client.send.mock.calls[1][0].input;
    expect(restamp.Key).toEqual({ PK: 'DEAL#d1', SK: 'METADATA' });
    expect(restamp.ExpressionAttributeValues[':gsi5pk']).toBe('STATUS#pending');
    expect(restamp.ExpressionAttributeValues[':gsi5sk']).toBe('2026-10-01#08:00#DEAL#d1');
    expect(restamp.ExpressionAttributeValues[':slotStart']).toBe('08:00');
    expect(deal.scheduledDate).toBe('2026-10-01');
  });

  it('update() of a status restamps too — the status is the partition key', async () => {
    const after = { ...createMockDeal({ id: 'd1', superStatus: JobSuperStatus.DONE }), PK: 'DEAL#d1', SK: 'METADATA' };
    dynamoDb.client.send.mockResolvedValueOnce({ Attributes: after }).mockResolvedValueOnce({ Attributes: after });
    await repository.update('d1', { superStatus: JobSuperStatus.DONE });
    expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
    expect(dynamoDb.client.send.mock.calls[1][0].input.ExpressionAttributeValues[':gsi5pk']).toBe('STATUS#done');
  });

  it('update() that clears the slot removes slotStart', async () => {
    const after = { ...createMockDeal({ id: 'd1', scheduledDate: '2026-10-01' }), PK: 'DEAL#d1', SK: 'METADATA' };
    delete (after as any).scheduledTimeSlot;
    dynamoDb.client.send.mockResolvedValueOnce({ Attributes: after }).mockResolvedValueOnce({ Attributes: after });
    await repository.update('d1', { scheduledTimeSlot: null });
    const restamp = dynamoDb.client.send.mock.calls[1][0].input;
    expect(restamp.UpdateExpression).toMatch(/REMOVE .*#slotStart/);
    expect(restamp.ExpressionAttributeValues[':gsi5sk']).toBe('2026-10-01#~#DEAL#d1');
  });

  it('update() of an unrelated field is a single write', async () => {
    const after = { ...createMockDeal({ id: 'd1' }), PK: 'DEAL#d1', SK: 'METADATA' };
    dynamoDb.client.send.mockResolvedValueOnce({ Attributes: after });
    await repository.update('d1', { notes: 'hello' });
    expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
  });
});

describe('DealsRepository.findBySchedule — one status', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: DealsRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new DealsRepository(dynamoDb as any);
    dynamoDb.client.send.mockResolvedValue({ Items: [] });
  });

  it('a date window is a key range with an exclusive next-day upper bound', async () => {
    await repository.findBySchedule([JobSuperStatus.SUBMITTED], { from: '2026-09-21', to: '2026-09-27' }, 50);
    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.IndexName).toBe('StatusScheduleIndex');
    expect(input.KeyConditionExpression).toBe('GSI5PK = :pk AND GSI5SK BETWEEN :from AND :to');
    expect(input.ExpressionAttributeValues[':pk']).toBe('STATUS#submitted');
    expect(input.ExpressionAttributeValues[':from']).toBe('2026-09-21#');
    // Everything on the 27th, timed ('#09:00…') and all-day ('#~…'), sits below '#~~'.
    expect(input.ExpressionAttributeValues[':to']).toBe('2026-09-27#~~');
    expect(input.ScanIndexForward).toBe(true);
    expect(input.Limit).toBe(50);
  });

  it('a single day is from that day to the same day', async () => {
    await repository.findBySchedule([JobSuperStatus.DONE], { from: '2026-09-23', to: '2026-09-23' }, 50);
    const v = dynamoDb.client.send.mock.calls[0][0].input.ExpressionAttributeValues;
    expect(v[':from']).toBe('2026-09-23#');
    expect(v[':to']).toBe('2026-09-23#~~');
  });

  it('unscheduled is a begins_with on UNSCHED#', async () => {
    await repository.findBySchedule([JobSuperStatus.PENDING], { unscheduled: true }, 50);
    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.KeyConditionExpression).toBe('GSI5PK = :pk AND begins_with(GSI5SK, :unsched)');
    expect(input.ExpressionAttributeValues[':unsched']).toBe('UNSCHED#');
  });

  it('no window at all reads the whole status partition in schedule order', async () => {
    await repository.findBySchedule([JobSuperStatus.SUBMITTED], {}, 50, undefined, undefined, 'desc');
    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.KeyConditionExpression).toBe('GSI5PK = :pk');
    expect(input.ScanIndexForward).toBe(false);
  });

  it('the secondary filters and the hour window ride along as a FilterExpression', async () => {
    await repository.findBySchedule([JobSuperStatus.SUBMITTED], { from: '2026-09-23', to: '2026-09-23' }, 50, undefined, {
      jobTypeId: 'jt-1',
      subStatusId: 'sub-1',
      hourFrom: '08:00',
      hourTo: '12:00',
      techId: 'tech-1',
    });
    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.FilterExpression).toContain('#jobTypeId = :jobTypeId');
    expect(input.FilterExpression).toContain('#subStatusId = :subStatusId');
    expect(input.FilterExpression).toContain('#slotStart BETWEEN :hourFrom AND :hourTo');
    expect(input.FilterExpression).toContain('contains(#assignedTechIds, :techId)');
    expect(input.ExpressionAttributeValues[':hourFrom']).toBe('08:00');
    expect(input.ExpressionAttributeValues[':hourTo']).toBe('12:00');
  });

  it('the page cursor round-trips through the query', async () => {
    dynamoDb.client.send.mockResolvedValue({
      Items: [{ ...createMockDeal({ id: 'd1' }), PK: 'DEAL#d1', SK: 'METADATA', GSI5PK: 'STATUS#submitted', GSI5SK: '2026-09-23#09:00#DEAL#d1' }],
      LastEvaluatedKey: { PK: 'DEAL#d1', SK: 'METADATA', GSI5PK: 'STATUS#submitted', GSI5SK: '2026-09-23#09:00#DEAL#d1' },
    });
    const page1 = await repository.findBySchedule([JobSuperStatus.SUBMITTED], {}, 1);
    expect(page1.items.map((d) => d.id)).toEqual(['d1']);
    expect(page1.nextCursor).toBeDefined();

    await repository.findBySchedule([JobSuperStatus.SUBMITTED], {}, 1, page1.nextCursor);
    const input = dynamoDb.client.send.mock.calls[1][0].input;
    expect(input.ExclusiveStartKey).toEqual({ PK: 'DEAL#d1', SK: 'METADATA', GSI5PK: 'STATUS#submitted', GSI5SK: '2026-09-23#09:00#DEAL#d1' });
  });
});

describe('DealsRepository.findBySchedule — several statuses merged', () => {
  const row = (id: string, status: JobSuperStatus, sk: string) => ({
    ...createMockDeal({ id, superStatus: status }),
    PK: `DEAL#${id}`,
    SK: 'METADATA',
    GSI5PK: `STATUS#${status}`,
    GSI5SK: sk,
  });

  it('queries every status and merges the pages in key order', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    dynamoDb.client.send.mockImplementation(async (cmd: any) => {
      const pk = cmd.input.ExpressionAttributeValues[':pk'];
      if (pk === 'STATUS#submitted') return { Items: [row('s1', JobSuperStatus.SUBMITTED, '2026-09-23#09:00#DEAL#s1'), row('s2', JobSuperStatus.SUBMITTED, '2026-09-25#09:00#DEAL#s2')] };
      if (pk === 'STATUS#pending') return { Items: [row('p1', JobSuperStatus.PENDING, '2026-09-24#08:00#DEAL#p1')] };
      return { Items: [] };
    });

    const page = await repository.findBySchedule([JobSuperStatus.SUBMITTED, JobSuperStatus.PENDING], { from: '2026-09-21', to: '2026-09-30' }, 2);

    expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
    expect(page.items.map((d) => d.id)).toEqual(['s1', 'p1']);
    // s2 was fetched but not consumed: the cursor must resume before it.
    expect(page.nextCursor).toBeDefined();
  });

  it('the merged cursor resumes each status from its own last consumed row', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    dynamoDb.client.send.mockImplementation(async (cmd: any) => {
      const pk = cmd.input.ExpressionAttributeValues[':pk'];
      const after = cmd.input.ExclusiveStartKey?.GSI5SK as string | undefined;
      const all: Record<string, any[]> = {
        'STATUS#submitted': [row('s1', JobSuperStatus.SUBMITTED, '2026-09-23#09:00#DEAL#s1'), row('s2', JobSuperStatus.SUBMITTED, '2026-09-25#09:00#DEAL#s2')],
        'STATUS#pending': [row('p1', JobSuperStatus.PENDING, '2026-09-24#08:00#DEAL#p1'), row('p2', JobSuperStatus.PENDING, '2026-09-26#08:00#DEAL#p2')],
      };
      const rows = (all[pk] ?? []).filter((r) => !after || r.GSI5SK > after);
      return { Items: rows.slice(0, cmd.input.Limit) };
    });

    const page1 = await repository.findBySchedule([JobSuperStatus.SUBMITTED, JobSuperStatus.PENDING], {}, 2);
    expect(page1.items.map((d) => d.id)).toEqual(['s1', 'p1']);
    const page2 = await repository.findBySchedule([JobSuperStatus.SUBMITTED, JobSuperStatus.PENDING], {}, 2, page1.nextCursor);
    expect(page2.items.map((d) => d.id)).toEqual(['s2', 'p2']);
    // Both partitions were read to their end (no LastEvaluatedKey): no next page.
    expect(page2.nextCursor).toBeUndefined();
  });

  it('a partition the filter emptied resumes from where DynamoDB stopped, not from the same start', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    const stopped = { PK: 'DEAL#x', SK: 'METADATA', GSI5PK: 'STATUS#pending', GSI5SK: '2026-09-24#08:00#DEAL#x' };
    dynamoDb.client.send.mockImplementation(async (cmd: any) => {
      const pk = cmd.input.ExpressionAttributeValues[':pk'];
      if (pk === 'STATUS#submitted') return { Items: [row('s1', JobSuperStatus.SUBMITTED, '2026-09-23#09:00#DEAL#s1')] };
      // Filtered to nothing, but the range goes on.
      if (pk === 'STATUS#pending') return { Items: [], LastEvaluatedKey: stopped };
      return { Items: [] };
    });
    const page = await repository.findBySchedule([JobSuperStatus.SUBMITTED, JobSuperStatus.PENDING], {}, 5, undefined, { jobTypeId: 'jt' });
    expect(page.items.map((d) => d.id)).toEqual(['s1']);
    const cursors = JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString());
    expect(cursors.pending).toEqual(stopped);
    expect(cursors.submitted).toBe('done');
  });

  it('descending order merges newest first', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    dynamoDb.client.send.mockImplementation(async (cmd: any) => {
      expect(cmd.input.ScanIndexForward).toBe(false);
      const pk = cmd.input.ExpressionAttributeValues[':pk'];
      if (pk === 'STATUS#submitted') return { Items: [row('s2', JobSuperStatus.SUBMITTED, '2026-09-25#09:00#DEAL#s2')] };
      if (pk === 'STATUS#pending') return { Items: [row('p2', JobSuperStatus.PENDING, '2026-09-26#08:00#DEAL#p2')] };
      return { Items: [] };
    });
    const page = await repository.findBySchedule([JobSuperStatus.SUBMITTED, JobSuperStatus.PENDING], {}, 5, undefined, undefined, 'desc');
    expect(page.items.map((d) => d.id)).toEqual(['p2', 's2']);
  });
});
