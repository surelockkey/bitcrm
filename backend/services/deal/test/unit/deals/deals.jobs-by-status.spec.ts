import { JobSuperStatus } from '@bitcrm/types';
import { DealsService } from 'src/deals/deals.service';

/**
 * «Jobs By Status» — серія для дашборда: по дню на стовпчик, три стани.
 *
 * Станів у моделі шість, на графіку три. Згортка одна й та сама скрізь:
 * `canceled` і `done` — самі по собі, решта чотири (зокрема
 * `done_pending_approval`, який ще чекає підпису) — це `open`. Саме так
 * `CLOSED_SUPER_STATUSES` і ділить набір.
 *
 * Дні без робіт мусять бути в серії нулями, а не пропусками: графік малює
 * вісь із рівним кроком, і пропущений день зсунув би всі наступні.
 */
describe('DealsService.jobsByStatus', () => {
  function make(byStatus: Partial<Record<JobSuperStatus, Record<string, number>>> = {}, atLeast = false) {
    const repository = {
      countCreatedByDay: jest.fn(async (status: JobSuperStatus) => ({
        byDay: byStatus[status] ?? {},
        atLeast,
      })),
    };
    const store = new Map<string, string>();
    const cache = {
      getJson: jest.fn(async (k: string) => (store.has(k) ? JSON.parse(store.get(k)!) : null)),
      setJson: jest.fn(async (k: string, v: unknown, _ttl?: number) => {
        store.set(k, JSON.stringify(v));
      }),
    };
    // DealsService takes fourteen collaborators; this case needs two.
    const stub = {} as never;
    const service = new DealsService(
      repository as never, cache as never,
      stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
    );
    return { service, repository, cache };
  }

  const window = { from: '2026-09-14', to: '2026-09-16' };

  it('gives a row for every day of the window, in order', async () => {
    const { service } = make();

    const out = await service.jobsByStatus(window);

    expect(out.days.map((d) => d.day)).toEqual(['2026-09-14', '2026-09-15', '2026-09-16']);
  });

  it('a day with no jobs is zeros, not a gap', async () => {
    const { service } = make({ [JobSuperStatus.DONE]: { '2026-09-15': 4 } });

    const out = await service.jobsByStatus(window);

    expect(out.days[0]).toEqual({ day: '2026-09-14', open: 0, done: 0, canceled: 0 });
    expect(out.days[1]).toEqual({ day: '2026-09-15', open: 0, done: 4, canceled: 0 });
  });

  it('folds the four unclosed statuses into open', async () => {
    const { service } = make({
      [JobSuperStatus.SUBMITTED]: { '2026-09-14': 1 },
      [JobSuperStatus.IN_PROGRESS]: { '2026-09-14': 2 },
      [JobSuperStatus.PENDING]: { '2026-09-14': 3 },
      [JobSuperStatus.DONE_PENDING_APPROVAL]: { '2026-09-14': 4 },
    });

    const out = await service.jobsByStatus(window);

    expect(out.days[0].open).toBe(10);
    expect(out.days[0].done).toBe(0);
  });

  // Підписаний і непідписаний — різні речі; другий ще не «зроблено».
  it('keeps done-pending-approval out of done', async () => {
    const { service } = make({
      [JobSuperStatus.DONE]: { '2026-09-14': 5 },
      [JobSuperStatus.DONE_PENDING_APPROVAL]: { '2026-09-14': 2 },
    });

    const out = await service.jobsByStatus(window);

    expect(out.days[0].done).toBe(5);
    expect(out.days[0].open).toBe(2);
  });

  it('counts canceled on its own', async () => {
    const { service } = make({ [JobSuperStatus.CANCELED]: { '2026-09-16': 7 } });

    const out = await service.jobsByStatus(window);

    expect(out.days[2]).toEqual({ day: '2026-09-16', open: 0, done: 0, canceled: 7 });
  });

  it('asks the index once per status, not once per day', async () => {
    const { service, repository } = make();

    await service.jobsByStatus(window);

    expect(repository.countCreatedByDay).toHaveBeenCalledTimes(6);
  });

  it('a walk that stopped on its budget makes the whole series a floor', async () => {
    const { service } = make({}, true);

    expect((await service.jobsByStatus(window)).atLeast).toBe(true);
  });

  it('answers a repeat of the same window from the cache', async () => {
    const { service, repository } = make();

    await service.jobsByStatus(window);
    await service.jobsByStatus(window);

    expect(repository.countCreatedByDay).toHaveBeenCalledTimes(6);
  });

  it('counts again for a different window', async () => {
    const { service, repository } = make();

    await service.jobsByStatus(window);
    await service.jobsByStatus({ from: '2026-09-01', to: '2026-09-02' });

    expect(repository.countCreatedByDay).toHaveBeenCalledTimes(12);
  });

  // Вікно приходить із фронта; без стелі хтось попросив би десять років.
  it('refuses a window longer than the chart can honestly draw', async () => {
    const { service } = make();

    await expect(
      service.jobsByStatus({ from: '2020-01-01', to: '2026-09-16' }),
    ).rejects.toThrow();
  });

  it('refuses a window that runs backwards', async () => {
    const { service } = make();

    await expect(
      service.jobsByStatus({ from: '2026-09-16', to: '2026-09-14' }),
    ).rejects.toThrow();
  });

  describe('snapshots', () => {
    it('is kept a whole day — the nightly run builds it', async () => {
      const { service, cache } = make();

      await service.jobsByStatus(window);

      expect(cache.setJson.mock.calls[0][2]).toBeGreaterThanOrEqual(24 * 3600);
    });

    it('says when it was computed, and a cached read keeps that moment', async () => {
      const { service } = make();

      const first = await service.jobsByStatus(window);
      const again = await service.jobsByStatus(window);

      expect(Date.parse(first.computedAt!)).not.toBeNaN();
      expect(again.computedAt).toBe(first.computedAt);
    });

    it('fresh rebuilds it', async () => {
      const { service, repository } = make();

      await service.jobsByStatus(window);
      await service.jobsByStatus(window, { fresh: true });

      // Six statuses per build.
      expect(repository.countCreatedByDay).toHaveBeenCalledTimes(12);
    });
  });
});
