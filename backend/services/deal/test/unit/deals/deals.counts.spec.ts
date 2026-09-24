/**
 * `GET /deals/counts` — the numbers on the jobs-list tabs, answered by
 * `Select: COUNT` queries on the schedule index with the very filters the
 * list uses (web-deals-scale design, step 3). A closed status without a
 * date window would count a whole partition (Canceled ≈ 244 k after the
 * import), so it is counted only up to a ceiling: the tab shows the number
 * while the set is small and "10,000+" once it is not. A dash said nothing
 * to the one account where every job is Done.
 */
import { JobSuperStatus } from '@bitcrm/types';
import { DealsService } from '../../../src/deals/deals.service';
import { DealsRepository } from '../../../src/deals/deals.repository';
import { createMockDealsRepository, createMockDynamoDbService, createMockJwtUser } from '../mocks';

const caller = createMockJwtUser({ id: 'disp-1', roleId: 'role-dispatcher' });

function serviceWith(repo: ReturnType<typeof createMockDealsRepository>, cache: any = {}): DealsService {
  const stub = {} as any;
  return new DealsService(
    repo as any, cache, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
  );
}

describe('DealsRepository.countBySchedule', () => {
  it('asks the schedule index for a COUNT and sums every page', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    dynamoDb.client.send
      .mockResolvedValueOnce({ Count: 40, LastEvaluatedKey: { PK: 'x' } })
      .mockResolvedValueOnce({ Count: 2 });

    const n = await repository.countBySchedule(JobSuperStatus.SUBMITTED, { from: '2026-09-21', to: '2026-09-27' }, { jobTypeId: 'jt' });

    expect(n).toBe(42);
    const first = dynamoDb.client.send.mock.calls[0][0].input;
    expect(first.IndexName).toBe('StatusScheduleIndex');
    expect(first.Select).toBe('COUNT');
    expect(first.KeyConditionExpression).toBe('#pk = :pk AND #sk BETWEEN :from AND :to');
    expect(first.ExpressionAttributeNames['#pk']).toBe('GSI5PK');
    expect(first.FilterExpression).toContain('#jobTypeId = :jobTypeId');
    expect(first.Limit).toBeUndefined();
    const second = dynamoDb.client.send.mock.calls[1][0].input;
    expect(second.ExclusiveStartKey).toEqual({ PK: 'x' });
  });

  it('stops at the ceiling instead of walking a whole partition', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    dynamoDb.client.send
      .mockResolvedValueOnce({ Count: 40, LastEvaluatedKey: { PK: 'x' } })
      .mockResolvedValueOnce({ Count: 40, LastEvaluatedKey: { PK: 'y' } })
      .mockResolvedValueOnce({ Count: 40, LastEvaluatedKey: { PK: 'z' } });

    const n = await repository.countBySchedule(JobSuperStatus.DONE, {}, undefined, 50);

    // Дві сторінки перетнули стелю — третьої не питаємо.
    expect(n).toBe(80);
    expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
  });

  it('counts to the end when the set is smaller than the ceiling', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    dynamoDb.client.send.mockResolvedValueOnce({ Count: 7 });

    expect(await repository.countBySchedule(JobSuperStatus.DONE, {}, undefined, 50)).toBe(7);
  });
});

describe('DealsService.counts', () => {
  let repo: ReturnType<typeof createMockDealsRepository>;
  let cache: { getJson: jest.Mock; setJson: jest.Mock };

  beforeEach(() => {
    repo = createMockDealsRepository();
    (repo as any).countBySchedule = jest.fn(async (status: JobSuperStatus, window: any) => {
      if (window.unscheduled) return status === JobSuperStatus.SUBMITTED ? 3 : 0;
      return { submitted: 10, in_progress: 1, pending: 5, done_pending_approval: 2, done: 100, canceled: 200 }[status] ?? 0;
    });
    cache = { getJson: jest.fn().mockResolvedValue(null), setJson: jest.fn() };
  });

  it('with a window counts every status and the undated open ones', async () => {
    const service = serviceWith(repo, cache);
    const counts = await service.counts({ scheduledFrom: '2026-09-21', scheduledTo: '2026-09-27' } as any, caller);
    expect(counts).toEqual({
      submitted: 10,
      in_progress: 1,
      pending: 5,
      done_pending_approval: 2,
      done: 100,
      canceled: 200,
      unscheduled: 3,
      total: 318,
      atLeast: [],
    });
    // Six statuses in the window + four open statuses undated.
    expect((repo as any).countBySchedule).toHaveBeenCalledTimes(10);
    const undatedCalls = (repo as any).countBySchedule.mock.calls.filter((c: any[]) => c[1].unscheduled);
    expect(undatedCalls.map((c: any[]) => c[0])).toEqual([
      JobSuperStatus.SUBMITTED,
      JobSuperStatus.IN_PROGRESS,
      JobSuperStatus.PENDING,
      JobSuperStatus.DONE_PENDING_APPROVAL,
    ]);
  });

  it('without a window the closed statuses are counted up to the ceiling', async () => {
    const service = serviceWith(repo, cache);
    const counts = await service.counts({} as any, caller);
    expect(counts.done).toBe(100);
    expect(counts.canceled).toBe(200);
    expect(counts.submitted).toBe(10);
    expect(counts.unscheduled).toBe(3);
    // Стеля їде в репозиторій лише для закритих: відкритих статусів мало
    // за визначенням, вони рахуються до кінця.
    const calls = (repo as any).countBySchedule.mock.calls;
    const doneCall = calls.find((c: any[]) => c[0] === JobSuperStatus.DONE);
    expect(doneCall[3]).toBe(10_000);
    const openCall = calls.find((c: any[]) => c[0] === JobSuperStatus.SUBMITTED);
    expect(openCall[3]).toBeUndefined();
  });

  it('says which numbers are a floor rather than a total', async () => {
    (repo as any).countBySchedule = jest.fn(async (status: JobSuperStatus) =>
      status === JobSuperStatus.CANCELED ? 10_000 : 4,
    );
    const service = serviceWith(repo, cache);

    const counts = await service.counts({} as any, caller);

    // 10 000 — це «не менше»: стільки нарахували і спинились. Сума, у якій
    // є такий доданок, теж лише «не менше».
    expect(counts.canceled).toBe(10_000);
    expect(counts.atLeast).toEqual([JobSuperStatus.CANCELED, 'total']);
  });

  it('nothing is a floor while every status was counted to the end', async () => {
    const service = serviceWith(repo, cache);

    expect((await service.counts({} as any, caller)).atLeast).toEqual([]);
  });

  it('the list filters and the data scope apply to the counts too', async () => {
    const service = serviceWith(repo, cache);
    await service.counts({ jobTypeId: 'jt-1', hourFrom: '08:00' } as any, caller, 'assigned_only');
    const [, , filters] = (repo as any).countBySchedule.mock.calls[0];
    expect(filters).toEqual(expect.objectContaining({ jobTypeId: 'jt-1', hourFrom: '08:00', techId: 'disp-1' }));
  });

  it('superStatus, cursor and limit do not shape the counts — every tab is answered', async () => {
    const service = serviceWith(repo, cache);
    const counts = await service.counts({ superStatus: JobSuperStatus.DONE, limit: 5, cursor: 'abc' } as any, caller);
    expect(Object.keys(counts).sort()).toEqual(
      ['canceled', 'done', 'done_pending_approval', 'in_progress', 'pending', 'submitted', 'unscheduled', 'total', 'atLeast'].sort(),
    );
  });

  it('a fresh answer is cached for thirty seconds and served from the cache next time', async () => {
    const service = serviceWith(repo, cache);
    await service.counts({ jobTypeId: 'jt-1' } as any, caller);
    expect(cache.setJson).toHaveBeenCalledWith(expect.stringMatching(/^deal-counts:/), expect.any(Object), 30);

    cache.getJson.mockResolvedValueOnce({ submitted: 7, unscheduled: 0 });
    (repo as any).countBySchedule.mockClear();
    const again = await service.counts({ jobTypeId: 'jt-1' } as any, caller);
    expect(again).toEqual({ submitted: 7, unscheduled: 0 });
    expect((repo as any).countBySchedule).not.toHaveBeenCalled();
  });

  it('two callers under assigned_only do not share a cache entry', async () => {
    const service = serviceWith(repo, cache);
    await service.counts({} as any, caller, 'assigned_only');
    await service.counts({} as any, createMockJwtUser({ id: 'tech-2' }), 'assigned_only');
    const [k1] = cache.setJson.mock.calls[0];
    const [k2] = cache.setJson.mock.calls[1];
    expect(k1).not.toBe(k2);
  });
});
