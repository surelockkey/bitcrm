/**
 * The Done-lines keys — the Items and services report's lines without one
 * Query per job. They ride on the job's `PRODUCT#` rows, on the EndIndex
 * (GSI7), whose keys line rows never carried:
 *
 *   GSI7PK = DONELINES#<YYYY-MM>
 *   GSI7SK = <day>#DEAL#<dealId>#<lineKey>
 *
 * `<day>` is the job's StatusScheduleIndex day (`scheduledDate`, the day the
 * report windows on), or its creation day when it has none. Sparse: only on
 * lines of a live, Done job.
 */
import { DealStatus, JobSuperStatus } from '@bitcrm/types';
import { DealsRepository } from '../../../src/deals/deals.repository';
import { DealProductsRepository } from '../../../src/products/deal-products.repository';
import {
  DONE_LINES_STATE_KEY,
  doneLineKeys,
  doneLinesDay,
  doneLinesReadRange,
  planDoneLine,
} from '../../../src/deals/done-lines-index';
import { createMockDealProduct, createMockDynamoDbService } from '../mocks';

const meta = (over: Record<string, unknown> = {}) => ({
  PK: 'DEAL#d1',
  SK: 'METADATA',
  id: 'd1',
  status: DealStatus.ACTIVE,
  superStatus: JobSuperStatus.DONE,
  scheduledDate: '2026-09-12',
  createdAt: '2026-09-10T15:00:00.000Z',
  ...over,
});

describe('doneLinesDay — which day a job files its lines under', () => {
  it('a live Done job: its visit day, as the schedule index has it', () => {
    expect(doneLinesDay(meta())).toBe('2026-09-12');
  });

  it('an undated Done job: its creation day (UTC), as the window reads the undated ones by createdAt', () => {
    expect(doneLinesDay(meta({ scheduledDate: undefined }))).toBe('2026-09-10');
    expect(doneLinesDay(meta({ scheduledDate: '' }))).toBe('2026-09-10');
  });

  it('a legacy row without superStatus falls back on its stage, as toDeal does', () => {
    expect(doneLinesDay(meta({ superStatus: undefined, stage: 'completed' }))).toBe('2026-09-12');
  });

  it.each([
    ['open', { superStatus: JobSuperStatus.SUBMITTED }],
    ['canceled', { superStatus: JobSuperStatus.CANCELED }],
    ['deleted', { status: DealStatus.DELETED }],
    ['without any date', { scheduledDate: undefined, createdAt: undefined }],
  ])('none for a job that is %s', (_what, over) => {
    expect(doneLinesDay(meta(over))).toBeUndefined();
  });
});

describe('doneLineKeys / planDoneLine', () => {
  it('a month partition, sorted by day, one key per line of the job', () => {
    expect(doneLineKeys('d1', 'line-1', '2026-09-12')).toEqual({
      GSI7PK: 'DONELINES#2026-09',
      GSI7SK: '2026-09-12#DEAL#d1#line-1',
    });
  });

  it('sets missing keys, keeps right ones, removes keys a line no longer qualifies for', () => {
    const line = { PK: 'DEAL#d1', SK: 'PRODUCT#line-1' };
    expect(planDoneLine(line, '2026-09-12')).toEqual({ action: 'set', pk: 'DONELINES#2026-09', sk: '2026-09-12#DEAL#d1#line-1' });
    expect(planDoneLine({ ...line, GSI7PK: 'DONELINES#2026-09', GSI7SK: '2026-09-12#DEAL#d1#line-1' }, '2026-09-12')).toEqual({
      action: 'same',
    });
    expect(planDoneLine({ ...line, GSI7PK: 'DONELINES#2026-09', GSI7SK: 'x' }, undefined)).toEqual({ action: 'remove' });
    expect(planDoneLine(line, undefined)).toEqual({ action: 'same' });
  });

  it('the read range of a window covers every day the window read can return, a margin either side', () => {
    expect(doneLinesReadRange('2026-09-01', '2026-09-30')).toEqual({
      months: ['2026-08', '2026-09', '2026-10'],
      lo: '2026-08-30#',
      hi: '2026-10-02#~',
    });
  });

  it('the readiness row', () => {
    expect(DONE_LINES_STATE_KEY).toEqual({ PK: 'DONELINESINDEX', SK: 'STATE' });
  });
});

describe('DealProductsRepository — a line write files the line', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: DealProductsRepository;
  const sent = () => dynamoDb.client.send.mock.calls.map((c: any[]) => ({ name: c[0].constructor.name, input: c[0].input }));

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new DealProductsRepository(dynamoDb as any);
  });

  it('a line added to a Done job gets its keys — read off the job AFTER the line is written', async () => {
    dynamoDb.client.send.mockImplementation(async (cmd: any) =>
      cmd.constructor.name === 'GetCommand' ? { Item: meta() } : {},
    );
    await repository.addProduct('d1', createMockDealProduct({ lineId: 'line-1' }));
    const calls = sent();
    expect(calls.map((c) => c.name)).toEqual(['PutCommand', 'GetCommand', 'UpdateCommand']);
    expect(calls[1].input).toMatchObject({ Key: { PK: 'DEAL#d1', SK: 'METADATA' }, ConsistentRead: true });
    expect(calls[2].input.Key).toEqual({ PK: 'DEAL#d1', SK: 'PRODUCT#line-1' });
    expect(calls[2].input.UpdateExpression).toBe('SET GSI7PK = :pk, GSI7SK = :sk');
    expect(calls[2].input.ExpressionAttributeValues).toEqual({ ':pk': 'DONELINES#2026-09', ':sk': '2026-09-12#DEAL#d1#line-1' });
    // A line removed in between is not written back to life.
    expect(calls[2].input.ConditionExpression).toBe('attribute_exists(PK)');
  });

  it('a line added to an open job costs one read and no second write', async () => {
    dynamoDb.client.send.mockImplementation(async (cmd: any) =>
      cmd.constructor.name === 'GetCommand' ? { Item: meta({ superStatus: JobSuperStatus.SUBMITTED }) } : {},
    );
    await repository.addProduct('d1', createMockDealProduct({ lineId: 'line-1' }));
    expect(sent().map((c) => c.name)).toEqual(['PutCommand', 'GetCommand']);
  });

  it('a failure to file never fails the line write', async () => {
    dynamoDb.client.send.mockImplementation(async (cmd: any) => {
      if (cmd.constructor.name === 'GetCommand') throw new Error('throttled');
      return {};
    });
    await expect(repository.addProduct('d1', createMockDealProduct({ lineId: 'line-1' }))).resolves.toBeUndefined();
  });
});

describe('DealsRepository.update — a job entering / leaving Done restamps its lines', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: DealsRepository;
  const sent = () => dynamoDb.client.send.mock.calls.map((c: any[]) => ({ name: c[0].constructor.name, input: c[0].input }));

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new DealsRepository(dynamoDb as any);
  });

  const table = (after: Record<string, unknown>, lines: Record<string, unknown>[]) =>
    dynamoDb.client.send.mockImplementation(async (cmd: any) => {
      const name = cmd.constructor.name;
      if (name === 'QueryCommand') return { Items: lines };
      if (name === 'UpdateCommand' && cmd.input.Key.SK === 'METADATA') return { Attributes: after };
      return {};
    });

  it('turning Done files every line of the job (consistent read of the lines)', async () => {
    table(meta({ itemCount: 2 }), [
      { PK: 'DEAL#d1', SK: 'PRODUCT#a' },
      { PK: 'DEAL#d1', SK: 'PRODUCT#b', GSI7PK: 'DONELINES#2026-09', GSI7SK: '2026-09-12#DEAL#d1#b' },
    ]);
    await repository.update('d1', { superStatus: JobSuperStatus.DONE });

    const q = sent().find((c) => c.name === 'QueryCommand')!;
    expect(q.input.IndexName).toBeUndefined();
    expect(q.input.ConsistentRead).toBe(true);
    expect(q.input.ExpressionAttributeValues).toMatchObject({ ':pk': 'DEAL#d1', ':sk': 'PRODUCT#' });
    const lineWrites = sent().filter((c) => c.name === 'UpdateCommand' && String(c.input.Key.SK).startsWith('PRODUCT#'));
    // Only the line that differs is written.
    expect(lineWrites).toHaveLength(1);
    expect(lineWrites[0].input.Key.SK).toBe('PRODUCT#a');
    expect(lineWrites[0].input.ExpressionAttributeValues).toEqual({ ':pk': 'DONELINES#2026-09', ':sk': '2026-09-12#DEAL#d1#a' });
  });

  it('leaving Done takes the lines off', async () => {
    table(meta({ superStatus: JobSuperStatus.IN_PROGRESS, itemCount: 1 }), [
      { PK: 'DEAL#d1', SK: 'PRODUCT#a', GSI7PK: 'DONELINES#2026-09', GSI7SK: '2026-09-12#DEAL#d1#a' },
    ]);
    await repository.update('d1', { superStatus: JobSuperStatus.IN_PROGRESS });
    const lineWrites = sent().filter((c) => c.name === 'UpdateCommand' && String(c.input.Key.SK).startsWith('PRODUCT#'));
    expect(lineWrites.map((w) => w.input.UpdateExpression)).toEqual(['REMOVE GSI7PK, GSI7SK']);
  });

  it('a new visit day moves them to the new day (and month)', async () => {
    table(meta({ scheduledDate: '2026-10-01', itemCount: 1 }), [
      { PK: 'DEAL#d1', SK: 'PRODUCT#a', GSI7PK: 'DONELINES#2026-09', GSI7SK: '2026-09-12#DEAL#d1#a' },
    ]);
    await repository.update('d1', { scheduledDate: '2026-10-01' });
    const lineWrites = sent().filter((c) => c.name === 'UpdateCommand' && String(c.input.Key.SK).startsWith('PRODUCT#'));
    expect(lineWrites[0].input.ExpressionAttributeValues).toEqual({ ':pk': 'DONELINES#2026-10', ':sk': '2026-10-01#DEAL#d1#a' });
  });

  it('a write that touches none of the inputs, or a job with no lines, reads no lines', async () => {
    table(meta({ itemCount: 0 }), []);
    await repository.update('d1', { notes: 'x' } as any);
    await repository.update('d1', { superStatus: JobSuperStatus.DONE });
    expect(sent().some((c) => c.name === 'QueryCommand')).toBe(false);
  });

  it('a failed restamp never fails the job write (the backfill reconciles)', async () => {
    dynamoDb.client.send.mockImplementation(async (cmd: any) => {
      const name = cmd.constructor.name;
      if (name === 'QueryCommand') throw new Error('throttled');
      if (name === 'UpdateCommand' && cmd.input.Key.SK === 'METADATA') return { Attributes: meta({ itemCount: 1 }) };
      return {};
    });
    await expect(repository.update('d1', { superStatus: JobSuperStatus.DONE })).resolves.toMatchObject({ id: 'd1' });
  });
});
