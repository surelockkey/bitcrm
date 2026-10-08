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
      jobsByStatus: jest.fn(async () => ({ days: [], atLeast: false, computedAt: '2026-09-28T07:00:00.000Z' })),
      counts: jest.fn(async () => ({
        submitted: 2, pending: 3, in_progress: 1, done_pending_approval: 4, done: 50, canceled: 6,
        unscheduled: 0, total: 66, atLeast: [],
      })),
    };
    const store = new Map<string, string>();
    const cache = {
      getJson: jest.fn(async (k: string) => (store.has(k) ? JSON.parse(store.get(k)!) : null)),
      setJson: jest.fn(async (k: string, v: unknown, _ttl?: number) => void store.set(k, JSON.stringify(v))),
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

  /**
   * Знімки. Нічний прогін будує агрегат кожного вікна наперед, і він живе до
   * наступного прогону — тож відкриття дашборда читає готове, а не рахує
   * квартал робіт на очах у користувача. «updated» показує, коли знімок
   * зроблено; кнопка оновлення перераховує його.
   */
  describe('snapshots', () => {
    it('an aggregate is kept a whole day, not thirty seconds', async () => {
      const { service, cache } = make();

      await service.shares('source', window, caller);

      const ttl = cache.setJson.mock.calls[0][2] as number;
      expect(ttl).toBeGreaterThanOrEqual(24 * 3600);
    });

    it('every widget says when its numbers were computed, and the cache keeps that moment', async () => {
      const { service } = make();

      const first = await service.shares('source', window, caller);
      const again = await service.sales(window, caller);
      const board = await service.scoreboard('tech', window, caller, true);

      expect(Date.parse(first.computedAt!)).not.toBeNaN();
      expect(board.computedAt).toBe(again.computedAt);
    });

    it('fresh recomputes even when a snapshot is there, and replaces it', async () => {
      const { service, deals } = make();

      await service.shares('source', window, caller);
      await service.shares('source', window, caller, { fresh: true });
      await service.shares('source', window, caller);

      expect(deals.stats).toHaveBeenCalledTimes(2);
    });
  });

  describe('warm — the nightly run', () => {
    // 08:00 in New York on Sep 28.
    const now = new Date('2026-09-28T12:00:00Z');

    it('builds every range the widgets offer — Workiz\'s four — for both windows and both audiences', async () => {
      const { service, deals } = make();

      await service.warm(now);

      const asked = deals.stats.mock.calls.map((c) => {
        const [q, , scope, opts] = c as unknown as [Record<string, string>, unknown, string, { money: boolean }];
        const by = q.createdFrom ? 'created' : 'closed';
        return `${by}:${q[`${by}From`]}:${q[`${by}To`]}:${opts.money}:${scope}`;
      });
      expect(asked.sort()).toEqual(
        // Workiz's four ranges on Monday Sep 28: this week (the Monday alone),
        // the last 14 days, this month, and June..August.
        [
          'closed:2026-09-28:2026-09-28:false:all',
          'closed:2026-09-28:2026-09-28:true:all',
          'closed:2026-09-14:2026-09-28:false:all',
          'closed:2026-09-14:2026-09-28:true:all',
          'closed:2026-09-01:2026-09-28:false:all',
          'closed:2026-09-01:2026-09-28:true:all',
          'closed:2026-06-01:2026-08-31:false:all',
          'closed:2026-06-01:2026-08-31:true:all',
          'created:2026-09-28:2026-09-28:false:all',
          'created:2026-09-14:2026-09-28:false:all',
          'created:2026-09-01:2026-09-28:false:all',
          'created:2026-06-01:2026-08-31:false:all',
        ].sort(),
      );
    });

    it('recomputes rather than trusting yesterday’s snapshot', async () => {
      const { service, deals } = make();

      await service.shares('source', { from: '2026-09-14', to: '2026-09-28' }, caller);
      await service.warm(now);

      // The one already cached is built again: 12 by the warm, 1 before it.
      expect(deals.stats).toHaveBeenCalledTimes(13);
    });

    it('builds the Jobs By Status series too', async () => {
      const { service, deals } = make();

      await service.warm(now);

      expect(deals.jobsByStatus.mock.calls.map((c) => c as unknown[])).toEqual([
        [{ from: '2026-09-28', to: '2026-09-28' }, { fresh: true }],
        [{ from: '2026-09-14', to: '2026-09-28' }, { fresh: true }],
        [{ from: '2026-09-01', to: '2026-09-28' }, { fresh: true }],
        [{ from: '2026-06-01', to: '2026-08-31' }, { fresh: true }],
      ]);
    });
  });

  /**
   * Пакет: усе, що дашборд показує при відкритті, одним запитом — щоб картки
   * з'являлись разом, а не сходинкою з одинадцяти відповідей. Сервер кладе
   * лише ті віджети, на які в ролі є грант; Sales — ще й з грошима.
   */
  describe('bundle', () => {
    const all = () => true;

    it('carries every widget the caller may see', async () => {
      const { service } = make();

      const out = await service.bundle(window, '2026-09-28', caller, all, true);

      expect(Object.keys(out).sort()).toEqual(
        [
          'dispatchScoreboard',
          'jobsByStatus',
          'jobsNow',
          'sales',
          'serviceAreas',
          'techScoreboard',
          'today',
          'topJobTypes',
          'topSources',
        ].sort(),
      );
    });

    it('leaves out a widget the role does not hold', async () => {
      const { service } = make();

      const out = await service.bundle(window, '2026-09-28', caller, (a) => a !== 'view_top_sources', true);

      expect(out).not.toHaveProperty('topSources');
      expect(out).toHaveProperty('topJobTypes');
    });

    it('no Sales without money, even with its grant', async () => {
      const { service } = make();

      const out = await service.bundle(window, '2026-09-28', caller, all, false);

      expect(out).not.toHaveProperty('sales');
      expect(out.techScoreboard?.rows.every((r) => r.sales === undefined)).toBe(true);
    });

    it('nothing at all for a role with no widgets', async () => {
      const { service, deals } = make();

      await expect(service.bundle(window, '2026-09-28', caller, () => false, true)).resolves.toEqual({});
      expect(deals.stats).not.toHaveBeenCalled();
    });

    it('widgets on one window share one aggregate, even asked for at once', async () => {
      const { service, deals } = make();

      await service.bundle(window, '2026-09-28', caller, all, true);

      // created (pies), closed with money (sales, boards), and the day twice
      // for Today — not one per widget.
      const windows = deals.stats.mock.calls.map((c) => JSON.stringify([(c as unknown[])[0], (c as unknown[])[3]]));
      expect(new Set(windows).size).toBe(windows.length);
    });
  });
});
