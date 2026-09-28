import { BadRequestException } from '@nestjs/common';
import { JobSuperStatus, type DealStats, type DealStatsBucket } from '@bitcrm/types';
import { DealDashboardService } from 'src/deals/dashboard/deal-dashboard.service';

/**
 * Сервіс віджетів дашборда: вікно → агрегат `/deals/stats` (увесь акаунт, а
 * не рядки користувача) → зріз. Агрегат кешується на тридцять секунд, бо
 * п'ять віджетів на одній сторінці питають те саме вікно.
 */
describe('DealDashboardService', () => {
  const caller = { id: 'u-me' } as never;

  const bucket = (key: string, over: Partial<DealStatsBucket> = {}): DealStatsBucket => ({
    key, all: 0, done: 0, open: 0, canceled: 0, ...over,
  });

  function statsFor(over: Partial<DealStats> = {}): DealStats {
    return {
      window: { by: 'created', from: '2026-09-14', to: '2026-09-28' },
      jobs: { total: 0, byStatus: {} as Record<JobSuperStatus, number> },
      series: [],
      byTech: [], byCreator: [], byJobType: [], bySource: [], byServiceArea: [], byCity: [], byZip: [],
      ...over,
    };
  }

  function make(result: DealStats = statsFor()) {
    const deals = {
      stats: jest.fn(async () => result),
      counts: jest.fn(async () => ({
        submitted: 2, pending: 3, in_progress: 1, done_pending_approval: 4, done: 50, canceled: 6,
        unscheduled: 0, total: 66, atLeast: [],
      })),
    };
    const store = new Map<string, string>();
    const cache = {
      getJson: jest.fn(async (k: string) => (store.has(k) ? JSON.parse(store.get(k)!) : null)),
      setJson: jest.fn(async (k: string, v: unknown) => void store.set(k, JSON.stringify(v))),
    };
    const jobTypes = { list: jest.fn(async () => [{ id: 't1', name: 'New Car key' }]) };
    const jobSources = { list: jest.fn(async () => [{ id: 's1', name: 'SURE TX PLATINUM' }]) };
    const http = {
      getUserNames: jest.fn(async (ids: string[]) =>
        ids.filter((id) => id === 'u1').map((id) => ({ id, firstName: 'Daniel', lastName: 'Munoz' })),
      ),
    };
    const service = new DealDashboardService(
      deals as never, cache as never, jobTypes as never, jobSources as never, http as never,
    );
    return { service, deals, cache, jobTypes, jobSources, http };
  }

  const window = { from: '2026-09-14', to: '2026-09-28' };

  describe('the window', () => {
    it('refuses one that runs backwards', async () => {
      const { service } = make();
      await expect(service.shares('source', { from: '2026-09-28', to: '2026-09-14' }, caller)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('refuses more than 92 days', async () => {
      const { service } = make();
      await expect(service.shares('source', { from: '2026-01-01', to: '2026-09-28' }, caller)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('shares — the pies count jobs by the day they were created', () => {
    it('asks stats for a created window over the whole account, without money', async () => {
      const { service, deals } = make();

      await service.shares('source', window, caller);

      expect(deals.stats).toHaveBeenCalledWith(
        expect.objectContaining({ createdFrom: '2026-09-14', createdTo: '2026-09-28' }),
        caller,
        'all',
        { money: false },
      );
    });

    it('names a source from its catalog', async () => {
      const { service } = make(statsFor({ bySource: [bucket('s1', { all: 3 })] }));

      const out = await service.shares('source', window, caller);

      expect(out.slices[0]).toMatchObject({ key: 's1', name: 'SURE TX PLATINUM', percent: 100 });
    });

    it('names a job type from its catalog', async () => {
      const { service } = make(statsFor({ byJobType: [bucket('t1', { all: 3 })] }));

      const out = await service.shares('jobType', window, caller);

      expect(out.slices[0].name).toBe('New Car key');
    });

    it('a service area is already its own name — no catalog read', async () => {
      const { service, jobTypes, jobSources } = make(statsFor({ byServiceArea: [bucket('SURE LOCK CT', { all: 3 })] }));

      const out = await service.shares('serviceArea', window, caller);

      expect(out.slices[0].name).toBe('SURE LOCK CT');
      expect(jobTypes.list).not.toHaveBeenCalled();
      expect(jobSources.list).not.toHaveBeenCalled();
    });

    it('the aggregate is read once for widgets on the same window', async () => {
      const { service, deals } = make();

      await service.shares('source', window, caller);
      await service.shares('jobType', window, caller);
      await service.shares('serviceArea', window, caller);

      expect(deals.stats).toHaveBeenCalledTimes(1);
    });
  });

  describe('sales — a sale is a Done job, on the day it closed', () => {
    it('asks for a closed window with money', async () => {
      const { service, deals } = make();

      await service.sales(window, caller);

      expect(deals.stats).toHaveBeenCalledWith(
        expect.objectContaining({ closedFrom: '2026-09-14', closedTo: '2026-09-28' }),
        caller,
        'all',
        { money: true },
      );
    });

    it('money and no-money aggregates are cached apart', async () => {
      const { service, deals } = make();

      await service.sales(window, caller);
      await service.scoreboard('tech', window, caller, false);

      expect(deals.stats).toHaveBeenCalledTimes(2);
    });
  });

  describe('scoreboard', () => {
    it('ranks techs of the closed window and names them', async () => {
      const { service, http } = make(
        statsFor({ byTech: [bucket('u1', { done: 5, revenue: 115_929.85 }), bucket('u2', { done: 44, revenue: 28_870 })] }),
      );

      const out = await service.scoreboard('tech', window, caller, true);

      expect(out.rows).toEqual([
        { id: 'u1', name: 'Daniel Munoz', jobs: 5, sales: 115_929.85 },
        { id: 'u2', name: '', jobs: 44, sales: 28_870 },
      ]);
      // Лише ті, хто на дошці, — не кожен, хто щось закрив за квартал.
      expect(http.getUserNames).toHaveBeenCalledWith(['u1', 'u2']);
    });

    it('dispatch is the job creator', async () => {
      const { service } = make(statsFor({ byCreator: [bucket('u1', { done: 4 })] }));

      const out = await service.scoreboard('dispatch', window, caller, false);

      expect(out.rows).toEqual([{ id: 'u1', name: 'Daniel Munoz', jobs: 4 }]);
    });
  });

  describe('today', () => {
    it('reads the day closed (with money when allowed) and the day created', async () => {
      const { service, deals } = make();

      await service.today('2026-09-28', caller, true);

      expect(deals.stats).toHaveBeenCalledWith(
        expect.objectContaining({ closedFrom: '2026-09-28', closedTo: '2026-09-28' }), caller, 'all', { money: true },
      );
      expect(deals.stats).toHaveBeenCalledWith(
        expect.objectContaining({ createdFrom: '2026-09-28', createdTo: '2026-09-28' }), caller, 'all', { money: false },
      );
    });

    it('refuses a day that is not YYYY-MM-DD', async () => {
      const { service } = make();
      await expect(service.today('yesterday', caller, true)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('jobsNow', () => {
    it('counts the unclosed states over the whole account', async () => {
      const { service, deals } = make();

      const out = await service.jobsNow(caller);

      expect(deals.counts).toHaveBeenCalledWith({}, caller, 'all');
      expect(out.byStatus).toEqual({ submitted: 2, pending: 3, in_progress: 1, done_pending_approval: 4 });
    });
  });
});
