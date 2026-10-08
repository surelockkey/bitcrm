/**
 * The jobs list's Search box and Workiz's "Filter results" on the repository:
 *
 *  - the search halves are written with the row (create) and restamped when
 *    one of their inputs changes (update), the client's half on its own;
 *  - `q` is one FilterExpression fragment; several values in a filter group
 *    are any-of (Workiz: OR inside a group, AND across groups);
 *  - a filtered page is FILLED: DynamoDB applies `Limit` to the rows it reads
 *    and filters afterwards, so one Query of 50 rows with a selective search
 *    comes back with two jobs or none. The read goes on until the page is
 *    full, the partition ends, or a read budget is spent — then the cursor
 *    resumes exactly where it stopped. Merging several status partitions
 *    (the Unscheduled tab) never lets a row past the point another
 *    partition has not been read to.
 */
import { JobSuperStatus } from '@bitcrm/types';
import { DealsRepository, FILL_MAX_READS } from 'src/deals/deals.repository';
import { clientSearchAttributes } from 'src/deals/deal-search';
import { createMockDeal, createMockDynamoDbService } from '../mocks';

type Row = Record<string, any>;

/**
 * A fake index partition that behaves like DynamoDB: sorted on the sort key,
 * `Limit` counts rows READ, the "filter" (`passes`) applies after the limit,
 * `LastEvaluatedKey` is the last row read while more remain.
 */
function fakeIndex(partitions: Record<string, Row[]>, passes: (row: Row) => boolean, skAttr = 'GSI5SK', pkAttr = 'GSI5PK') {
  return async (cmd: any) => {
    const input = cmd.input;
    if (!input.KeyConditionExpression) return {};
    const asc = input.ScanIndexForward !== false;
    const pk = input.ExpressionAttributeValues[':pk'];
    const sorted = [...(partitions[pk] ?? [])].sort((a, b) => (asc ? 1 : -1) * (a[skAttr] < b[skAttr] ? -1 : a[skAttr] > b[skAttr] ? 1 : 0));
    const after = input.ExclusiveStartKey?.[skAttr];
    let start = after === undefined ? 0 : sorted.findIndex((r) => (asc ? r[skAttr] > after : r[skAttr] < after));
    if (start < 0) start = sorted.length;
    const read = sorted.slice(start, start + (input.Limit ?? sorted.length));
    const items = read.filter(passes);
    const more = start + read.length < sorted.length;
    const last = read[read.length - 1];
    return {
      Items: items,
      Count: items.length,
      ScannedCount: read.length,
      LastEvaluatedKey: more ? { PK: last.PK, SK: last.SK, [pkAttr]: last[pkAttr], [skAttr]: last[skAttr] } : undefined,
    };
  };
}

const pad = (n: number) => String(n).padStart(6, '0');

function scheduleRow(id: string, status: JobSuperStatus, sk: string, extra: Row = {}): Row {
  return { ...createMockDeal({ id, superStatus: status }), PK: `DEAL#${id}`, SK: 'METADATA', GSI5PK: `STATUS#${status}`, GSI5SK: sk, ...extra };
}

describe('DealsRepository — writing the search halves', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: DealsRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new DealsRepository(dynamoDb as any);
  });

  it('create() writes the job’s own half', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repository.create(
      createMockDeal({ id: 'd1', dealNumber: '5TU7ZA', jobName: 'Mailbox lock', clientName: { firstName: 'Dustin', lastName: 'Roselle' } }),
    );
    const item = dynamoDb.client.send.mock.calls[0][0].input.Item;
    expect(item.searchText).toContain('#5tu7za');
    expect(item.searchText).toContain('mailbox lock');
    expect(item.searchText).toContain('dustin roselle');
    expect(item.searchText).toContain('atlanta');
    expect(item).toHaveProperty('searchDigits', '');
  });

  it('create() writes the client’s half when the service brought it', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repository.create({
      ...createMockDeal({ id: 'd1' }),
      ...clientSearchAttributes({ firstName: 'Kayleigh', lastName: 'Moss', phones: ['+12145550100'] }),
    });
    const item = dynamoDb.client.send.mock.calls[0][0].input.Item;
    expect(item.clientSearchText).toBe('kayleigh moss');
    expect(item.clientSearchDigits).toBe('12145550100');
  });

  it('update() of an input restamps the job’s half from the row as it stands after the write', async () => {
    const after = {
      ...createMockDeal({ id: 'd1', jobName: 'Rekey' }),
      PK: 'DEAL#d1',
      SK: 'METADATA',
      searchText: 'old',
      searchDigits: '',
    };
    dynamoDb.client.send.mockResolvedValueOnce({ Attributes: after }).mockResolvedValueOnce({ Attributes: after });

    await repository.update('d1', { jobName: 'Rekey' });

    expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
    const restamp = dynamoDb.client.send.mock.calls[1][0].input;
    expect(restamp.Key).toEqual({ PK: 'DEAL#d1', SK: 'METADATA' });
    expect(restamp.UpdateExpression).toBe('SET searchText = :searchText, searchDigits = :searchDigits');
    expect(restamp.ExpressionAttributeValues[':searchText']).toContain('rekey');
    expect(restamp.ConditionExpression).toBe('attribute_exists(PK)');
  });

  it('update() clearing the "Just here" name restamps without it', async () => {
    const after = { ...createMockDeal({ id: 'd1' }), PK: 'DEAL#d1', SK: 'METADATA', searchText: 'jane doe' };
    dynamoDb.client.send.mockResolvedValueOnce({ Attributes: after }).mockResolvedValueOnce({ Attributes: after });
    await repository.update('d1', { clientName: null });
    expect(dynamoDb.client.send.mock.calls[1][0].input.ExpressionAttributeValues[':searchText']).not.toContain('jane');
  });

  it('update() of an input that leaves the half as it was costs no second write', async () => {
    const deal = createMockDeal({ id: 'd1', jobName: 'Rekey' });
    const after = { ...deal, PK: 'DEAL#d1', SK: 'METADATA' };
    const { dealSearchAttributes } = await import('src/deals/deal-search');
    Object.assign(after, dealSearchAttributes(after));
    dynamoDb.client.send.mockResolvedValueOnce({ Attributes: after });
    await repository.update('d1', { jobName: 'Rekey' });
    expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
  });

  it('update() of anything else is still one write', async () => {
    dynamoDb.client.send.mockResolvedValueOnce({ Attributes: { ...createMockDeal({ id: 'd1' }), PK: 'DEAL#d1', SK: 'METADATA' } });
    await repository.update('d1', { notes: 'hello', tagIds: ['t'] });
    expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
  });

  it('the halves never leak into the Deal a read returns', async () => {
    dynamoDb.client.send.mockResolvedValue({
      Item: { ...createMockDeal({ id: 'd1' }), PK: 'DEAL#d1', SK: 'METADATA', searchText: 'x', clientSearchDigits: '12145550100' },
    });
    const deal = (await repository.findById('d1')) as unknown as Record<string, unknown>;
    expect(deal).not.toHaveProperty('searchText');
    expect(deal).not.toHaveProperty('clientSearchDigits');
  });

  it('setClientSearch() writes the client’s half of one job', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repository.setClientSearch('d1', { clientSearchText: 'ann lee', clientSearchDigits: '1214' });
    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.Key).toEqual({ PK: 'DEAL#d1', SK: 'METADATA' });
    expect(input.UpdateExpression).toBe('SET clientSearchText = :clientSearchText, clientSearchDigits = :clientSearchDigits');
    expect(input.ExpressionAttributeValues).toEqual({ ':clientSearchText': 'ann lee', ':clientSearchDigits': '1214' });
    expect(input.ConditionExpression).toBe('attribute_exists(PK)');
  });

  it('restampClientSearch() walks the client’s jobs on the contact index and rewrites only the stale ones', async () => {
    const fresh = { clientSearchText: 'ann lee', clientSearchDigits: '12145550100' };
    dynamoDb.client.send.mockImplementation(async (cmd: any) => {
      if (cmd.input.IndexName) {
        if (!cmd.input.ExclusiveStartKey) {
          return {
            Items: [
              { PK: 'DEAL#a', SK: 'METADATA', clientSearchText: 'ann smith', clientSearchDigits: '12145550100' },
              { PK: 'DEAL#b', SK: 'METADATA', ...fresh },
            ],
            LastEvaluatedKey: { PK: 'DEAL#b', SK: 'METADATA', GSI3PK: 'CONTACT#c1', GSI3SK: 'x' },
          };
        }
        return { Items: [{ PK: 'DEAL#c', SK: 'METADATA' }] };
      }
      return {};
    });

    const written = await repository.restampClientSearch('c1', fresh);

    expect(written).toBe(2);
    const queries = dynamoDb.client.send.mock.calls.map((c: any) => c[0].input).filter((i: any) => i.IndexName);
    expect(queries[0].IndexName).toBe('ContactIndex');
    expect(queries[0].ExpressionAttributeValues[':pk']).toBe('CONTACT#c1');
    const updates = dynamoDb.client.send.mock.calls.map((c: any) => c[0].input).filter((i: any) => i.UpdateExpression);
    expect(updates.map((u: any) => u.Key.PK).sort()).toEqual(['DEAL#a', 'DEAL#c']);
  });
});

describe('DealsRepository — q and the any-of filters in the FilterExpression', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: DealsRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new DealsRepository(dynamoDb as any);
    dynamoDb.client.send.mockResolvedValue({ Items: [] });
  });

  const filterOf = async (filters: any) => {
    await repository.findBySchedule([JobSuperStatus.SUBMITTED], {}, 50, undefined, filters);
    return dynamoDb.client.send.mock.calls[0][0].input;
  };

  it('q is ANDed with the other filters', async () => {
    const input = await filterOf({ text: { text: 'dustin', digits: undefined }, jobTypeId: 'jt' });
    expect(input.FilterExpression).toContain('(contains(#searchText, :qText) OR contains(#clientSearchText, :qText))');
    expect(input.FilterExpression).toContain('#jobTypeId = :jobTypeId');
    expect(input.ExpressionAttributeValues[':qText']).toBe('dustin');
  });

  it('several job types, areas and companies are IN lists; one is still an equality', async () => {
    const input = await filterOf({ jobTypeIds: ['a', 'b'], serviceAreas: ['Dallas'], businessProfileIds: ['bp1', 'bp2', 'bp3'] });
    expect(input.FilterExpression).toContain('#jobTypeId IN (:jobTypeId_0, :jobTypeId_1)');
    expect(input.FilterExpression).toContain('#serviceArea = :serviceArea_0');
    expect(input.FilterExpression).toContain('#businessProfileId IN (:businessProfileId_0, :businessProfileId_1, :businessProfileId_2)');
    expect(input.ExpressionAttributeValues).toMatchObject({ ':jobTypeId_0': 'a', ':jobTypeId_1': 'b', ':serviceArea_0': 'Dallas' });
  });

  it('several technicians are any-of; the scope technician still narrows on top', async () => {
    const input = await filterOf({ techIds: ['t1', 't2'], techId: 'me' });
    expect(input.FilterExpression).toContain('(contains(#assignedTechIds, :techAny0) OR contains(#assignedTechIds, :techAny1))');
    expect(input.FilterExpression).toContain('contains(#assignedTechIds, :techId)');
  });

  it('tags are all-of unless tagMatch=any', async () => {
    const all = await filterOf({ tagIds: ['x', 'y'] });
    expect(all.FilterExpression).toContain('contains(#tagIds, :tag0) AND contains(#tagIds, :tag1)');
    dynamoDb.client.send.mockClear();
    const any = await filterOf({ tagIds: ['x', 'y'], tagMatch: 'any' });
    expect(any.FilterExpression).toContain('(contains(#tagIds, :tag0) OR contains(#tagIds, :tag1))');
  });

  it('declares no attribute name the expressions do not use', async () => {
    const input = await filterOf({ text: { text: 'a', digits: '1234', jobTypeIds: ['jt'] }, jobTypeIds: ['x', 'y'], tagIds: ['t'], tagMatch: 'any', techIds: ['a'] });
    const used = new Set(`${input.KeyConditionExpression} ${input.FilterExpression}`.match(/#[A-Za-z0-9_]+/g));
    for (const name of Object.keys(input.ExpressionAttributeNames)) expect([...used]).toContain(name);
  });

  it('the in-memory matcher the tech index uses agrees', async () => {
    const table = (repository as any).tableName as string;
    const row = (id: string, extra: Row) => ({ ...createMockDeal({ id }), PK: `DEAL#${id}`, SK: 'METADATA', ...extra });
    dynamoDb.client.send.mockReset();
    dynamoDb.client.send
      .mockResolvedValueOnce({ Items: [{ dealId: 'a' }, { dealId: 'b' }, { dealId: 'c' }] })
      .mockResolvedValueOnce({
        Responses: {
          [table]: [
            row('a', { jobTypeId: 'x', tagIds: ['t2'], searchText: 'dustin roselle' }),
            row('b', { jobTypeId: 'y', tagIds: ['t1'], searchText: 'kayleigh' }),
            row('c', { jobTypeId: 'z', tagIds: ['t1'], searchText: 'dustin' }),
          ],
        },
      });
    const page = await repository.findByTech('tech', 20, undefined, {
      text: { text: 'dustin' },
      jobTypeIds: ['x', 'y'],
      tagIds: ['t1', 't2'],
      tagMatch: 'any',
    });
    expect(page.items.map((d) => d.id)).toEqual(['a']);
  });

  it('findByIds() with filters matches the raw rows, search halves included', async () => {
    const table = (repository as any).tableName as string;
    dynamoDb.client.send.mockReset();
    dynamoDb.client.send.mockResolvedValueOnce({
      Responses: {
        [table]: [
          { ...createMockDeal({ id: 'a' }), PK: 'DEAL#a', SK: 'METADATA', searchText: '#5tu7za' },
          { ...createMockDeal({ id: 'b' }), PK: 'DEAL#b', SK: 'METADATA', searchText: '#5tu7zb' },
        ],
      },
    });
    const found = await repository.findByIds(['a', 'b'], { text: { text: '5tu7za' } });
    expect(found.map((d) => d.id)).toEqual(['a']);
  });
});

describe('DealsRepository — a filtered page is filled', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: DealsRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new DealsRepository(dynamoDb as any);
  });

  const submitted = (n: number, matchEvery: number) =>
    Array.from({ length: n }, (_, i) =>
      scheduleRow(`s${pad(i)}`, JobSuperStatus.SUBMITTED, `2026-09-01#${pad(i)}#DEAL#s${pad(i)}`, { match: i % matchEvery === 0 }),
    );

  it('keeps reading past rows the filter dropped until the page is full, then resumes after the last row kept', async () => {
    dynamoDb.client.send.mockImplementation(fakeIndex({ 'STATUS#submitted': submitted(400, 10) }, (r) => r.match));

    const page1 = await repository.findBySchedule([JobSuperStatus.SUBMITTED], {}, 5, undefined, { text: { text: 'x' } });
    expect(page1.items.map((d) => d.id)).toEqual(['s000000', 's000010', 's000020', 's000030', 's000040']);
    expect(page1.nextCursor).toBeDefined();

    const page2 = await repository.findBySchedule([JobSuperStatus.SUBMITTED], {}, 5, page1.nextCursor, { text: { text: 'x' } });
    expect(page2.items.map((d) => d.id)).toEqual(['s000050', 's000060', 's000070', 's000080', 's000090']);
  });

  it('reads a partition with fewer matches than a page to its end, and says there is no more', async () => {
    dynamoDb.client.send.mockImplementation(fakeIndex({ 'STATUS#submitted': submitted(300, 100) }, (r) => r.match));
    const page = await repository.findBySchedule([JobSuperStatus.SUBMITTED], {}, 50, undefined, { text: { text: 'x' } });
    expect(page.items.map((d) => d.id)).toEqual(['s000000', 's000100', 's000200']);
    expect(page.nextCursor).toBeUndefined();
  });

  it('an unfiltered page still costs one read of exactly the page', async () => {
    dynamoDb.client.send.mockImplementation(fakeIndex({ 'STATUS#submitted': submitted(300, 1) }, () => true));
    const page = await repository.findBySchedule([JobSuperStatus.SUBMITTED], {}, 50);
    expect(page.items).toHaveLength(50);
    expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
    expect(dynamoDb.client.send.mock.calls[0][0].input.Limit).toBe(50);
  });

  it('stops on its read budget with a cursor from where it stopped — a huge closed partition is paged, never walked', async () => {
    dynamoDb.client.send.mockImplementation(fakeIndex({ 'STATUS#done': Array.from({ length: 40_000 }, (_, i) => scheduleRow(`d${pad(i)}`, JobSuperStatus.DONE, `2025-01-01#${pad(i)}#DEAL#d${pad(i)}`)) }, () => false));

    const page = await repository.findBySchedule([JobSuperStatus.DONE], {}, 50, undefined, { text: { text: 'zzz' } });

    expect(page.items).toEqual([]);
    expect(dynamoDb.client.send).toHaveBeenCalledTimes(FILL_MAX_READS);
    const cursor = JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString());
    const lastRead = dynamoDb.client.send.mock.results[FILL_MAX_READS - 1];
    expect(cursor.done).toEqual((await lastRead.value).LastEvaluatedKey);
  });

  it('merging statuses never takes a row past the point another status has not been read to', async () => {
    // Pending's only match sits deep in its partition, beyond one request's
    // read budget; Submitted's matches all sort after it. A merge that took
    // Submitted's rows first would print them above a job that comes earlier.
    const pending = Array.from({ length: 30_000 }, (_, i) =>
      scheduleRow(`p${pad(i)}`, JobSuperStatus.PENDING, `UNSCHED#~#DEAL#p${pad(i)}`, { match: i === 25_000 }),
    );
    const subs = Array.from({ length: 3 }, (_, i) => scheduleRow(`s${i}`, JobSuperStatus.SUBMITTED, `UNSCHED#~#DEAL#t${i}`, { match: true }));
    dynamoDb.client.send.mockImplementation(fakeIndex({ 'STATUS#pending': pending, 'STATUS#submitted': subs }, (r) => r.match));

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10 && seen.length < 2; guard++) {
      const page = await repository.findBySchedule([JobSuperStatus.SUBMITTED, JobSuperStatus.PENDING], { unscheduled: true }, 2, cursor, { text: { text: 'x' } });
      seen.push(...page.items.map((d) => d.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }

    expect(seen.slice(0, 2)).toEqual(['p025000', 's0']);
  });

  it('a status tab without the schedule sort (findBySuperStatus) is filled the same way, newest first', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({
      ...createMockDeal({ id: `r${pad(i)}` }),
      PK: `DEAL#r${pad(i)}`,
      SK: 'METADATA',
      GSI1PK: 'STATUS#submitted',
      GSI1SK: `2026-09-01T00:00:00.000Z#${pad(i)}`,
      match: i % 20 === 0,
    }));
    dynamoDb.client.send.mockImplementation(fakeIndex({ 'STATUS#submitted': rows }, (r) => r.match, 'GSI1SK', 'GSI1PK'));

    const page1 = await repository.findBySuperStatus(JobSuperStatus.SUBMITTED, 3, undefined, { text: { text: 'x' } });
    expect(page1.items.map((d) => d.id)).toEqual(['r000180', 'r000160', 'r000140']);
    const page2 = await repository.findBySuperStatus(JobSuperStatus.SUBMITTED, 3, page1.nextCursor, { text: { text: 'x' } });
    expect(page2.items.map((d) => d.id)).toEqual(['r000120', 'r000100', 'r000080']);
  });
});
