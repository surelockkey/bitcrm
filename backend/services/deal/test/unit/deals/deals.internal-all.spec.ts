/**
 * `GET /deals/internal/all` — every live deal, paged, for the search backfill
 * and billing's payment-report rebuild. It used to be a filtered Scan of the
 * whole deals table (mostly line items, timeline rows and catalogs); it now
 * walks the StageIndex partitions `STATUS#<superStatus>` one status after the
 * other, with an opaque cursor (status index + DynamoDB key) the callers just
 * hand back.
 */
import { DealStatus, JobSuperStatus, SUPER_STATUS_ORDER } from '@bitcrm/types';
import { DealsRepository } from 'src/deals/deals.repository';
import { DealsService } from 'src/deals/deals.service';
import { createMockDeal, createMockDealsRepository, createMockDynamoDbService } from '../mocks';

const row = (id: string, status: JobSuperStatus) => ({
  ...createMockDeal({ id, superStatus: status }),
  PK: `DEAL#${id}`,
  SK: 'METADATA',
  GSI1PK: `STATUS#${status}`,
  GSI1SK: `2026-01-01T00:00:00.000Z#DEAL#${id}`,
});

const decode = (cursor: string) => JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

describe('DealsRepository.listAllForIndex', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: DealsRepository;
  /** Rows per status partition; a partition is answered `limit` rows at a time. */
  let partitions: Record<string, ReturnType<typeof row>[]>;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new DealsRepository(dynamoDb as any);
    partitions = {};
    dynamoDb.client.send.mockImplementation(async (cmd: any) => {
      const input = cmd.input;
      const rows = partitions[input.ExpressionAttributeValues[':pk']] ?? [];
      const start = input.ExclusiveStartKey
        ? rows.findIndex((r) => r.PK === input.ExclusiveStartKey.PK) + 1
        : 0;
      const items = rows.slice(start, start + input.Limit);
      const more = start + input.Limit < rows.length;
      return {
        Items: items,
        ScannedCount: items.length,
        ...(more && { LastEvaluatedKey: { PK: items[items.length - 1].PK, SK: 'METADATA' } }),
      };
    });
  });

  it('queries the StageIndex, never Scans the table, and keeps only live deals', async () => {
    await repository.listAllForIndex(50);

    const inputs = dynamoDb.client.send.mock.calls.map((c: any[]) => c[0]);
    expect(inputs.every((c: any) => c.constructor.name === 'QueryCommand')).toBe(true);
    const first = inputs[0].input;
    expect(first.IndexName).toBe('StageIndex');
    expect(first.KeyConditionExpression).toBe('GSI1PK = :pk');
    expect(first.ExpressionAttributeValues[':pk']).toBe(`STATUS#${SUPER_STATUS_ORDER[0]}`);
    expect(first.FilterExpression).toBe('#status = :active');
    expect(first.ExpressionAttributeValues[':active']).toBe(DealStatus.ACTIVE);
  });

  it('walks every super status in turn, so every deal is listed once', async () => {
    partitions['STATUS#submitted'] = [row('s1', JobSuperStatus.SUBMITTED), row('s2', JobSuperStatus.SUBMITTED)];
    partitions['STATUS#done'] = [row('d1', JobSuperStatus.DONE)];
    partitions['STATUS#canceled'] = [row('c1', JobSuperStatus.CANCELED), row('c2', JobSuperStatus.CANCELED)];

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await repository.listAllForIndex(2, cursor);
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((d) => d.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 20);

    expect(seen.sort()).toEqual(['c1', 'c2', 'd1', 's1', 's2']);
    expect(cursor).toBeUndefined();
    const statuses = new Set(
      dynamoDb.client.send.mock.calls.map((c: any[]) => c[0].input.ExpressionAttributeValues[':pk']),
    );
    expect([...statuses].sort()).toEqual(SUPER_STATUS_ORDER.map((s) => `STATUS#${s}`).sort());
  });

  it('fills a page across partitions and hands back an opaque cursor', async () => {
    partitions['STATUS#submitted'] = [row('s1', JobSuperStatus.SUBMITTED)];
    partitions['STATUS#in_progress'] = [row('i1', JobSuperStatus.IN_PROGRESS), row('i2', JobSuperStatus.IN_PROGRESS)];

    const page = await repository.listAllForIndex(2);

    expect(page.items.map((d) => d.id)).toEqual(['s1', 'i1']);
    expect(typeof page.nextCursor).toBe('string');
    const c = decode(page.nextCursor!);
    expect(c.s).toBe(SUPER_STATUS_ORDER.indexOf(JobSuperStatus.IN_PROGRESS));
    expect(c.k).toEqual(expect.objectContaining({ PK: 'DEAL#i1' }));

    const next = await repository.listAllForIndex(2, page.nextCursor);
    expect(next.items.map((d) => d.id)).toEqual(['i2']);
    expect(next.nextCursor).toBeUndefined();
  });

  it('an empty table answers no items and no cursor', async () => {
    const page = await repository.listAllForIndex(200);
    expect(page).toEqual({ items: [], nextCursor: undefined });
    expect(dynamoDb.client.send).toHaveBeenCalledTimes(SUPER_STATUS_ORDER.length);
  });

  it('resumes at the status the cursor names', async () => {
    partitions['STATUS#canceled'] = [row('c1', JobSuperStatus.CANCELED)];
    const cursor = encode({ s: SUPER_STATUS_ORDER.indexOf(JobSuperStatus.CANCELED) });

    const page = await repository.listAllForIndex(10, cursor);

    expect(page.items.map((d) => d.id)).toEqual(['c1']);
    expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
  });

  it('refuses a cursor it did not hand out (e.g. one from the old Scan) instead of restarting', async () => {
    await expect(repository.listAllForIndex(10, encode({ PK: 'DEAL#x', SK: 'METADATA' }))).rejects.toThrow();
    await expect(repository.listAllForIndex(10, 'not-a-cursor')).rejects.toThrow();
  });
});

describe('DealsService.findAll (internal)', () => {
  it('reads the StageIndex walk, not the filtered table Scan', async () => {
    const repo = createMockDealsRepository() as any;
    repo.listAllForIndex = jest.fn().mockResolvedValue({ items: [], nextCursor: 'n' });
    const stub = {} as any;
    const service = new DealsService(repo, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub);

    await expect(service.findAll(200, 'c')).resolves.toEqual({ items: [], nextCursor: 'n' });
    expect(repo.listAllForIndex).toHaveBeenCalledWith(200, 'c');
    expect(repo.findAll).not.toHaveBeenCalled();
  });
});
