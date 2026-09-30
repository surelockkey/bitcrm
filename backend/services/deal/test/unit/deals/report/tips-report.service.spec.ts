import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { type ResolvedPermissions } from '@bitcrm/types';
import { DealsModule } from 'src/deals/deals.module';
import { DealsController } from 'src/deals/deals.controller';
import { ReportWindowTooLargeError } from 'src/deals/deals.repository';
import { JobsReportService, type ReportCaller } from 'src/deals/report/jobs-report.service';
import { TipsReportController } from 'src/deals/report/tips-report.controller';
import { TipsReportService } from 'src/deals/report/tips-report.service';
import { parseTipsReportJobsQuery, parseTipsReportQuery } from 'src/deals/report/tips-report.query';
import type { TipsReportJobsQueryDto, TipsReportQueryDto } from 'src/deals/report/tips-report.query';
import { createMockJwtUser } from '../../mocks';

/** A deal row as the window read projects it; job date 2026-09-12 10:00 Eastern. */
const item = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  status: 'active',
  dealNumber: id.toUpperCase(),
  contactId: `c-${id}`,
  jobTypeId: 'jt1',
  createdAt: '2026-09-10T15:00:00.000Z',
  scheduledDate: '2026-09-12',
  scheduledEndDate: '2026-09-12',
  scheduledTimeSlot: '10:00-11:00',
  superStatus: 'done',
  assignedTechIds: ['t1'],
  totals: { total: 100 },
  ...over,
});

const perms = (grants: Record<string, Record<string, boolean>>, dealsScope = 'all'): ResolvedPermissions =>
  ({ roleId: 'r', roleName: 'Dispatcher', isSystemRole: false, permissions: grants, dataScope: { deals: dealsScope } }) as unknown as ResolvedPermissions;

const FULL = perms({ reports: { view: true }, financials: { view: true } });

describe('TipsReportService', () => {
  let repository: { readReportWindow: jest.Mock };
  let http: { getUserNamesBatch: jest.Mock; getContactNames: jest.Mock };
  let service: TipsReportService;
  const caller = (p: ResolvedPermissions = FULL, id = 'me'): ReportCaller => ({ user: createMockJwtUser({ id }), perms: p });
  const q = (over: Partial<TipsReportQueryDto> = {}) => ({ from: '2026-09-01', to: '2026-09-27', ...over }) as TipsReportQueryDto;
  const jq = (over: Partial<TipsReportJobsQueryDto> = {}) => ({ ...q(), tech: 't1', ...over }) as TipsReportJobsQueryDto;

  beforeEach(() => {
    repository = {
      readReportWindow: jest.fn().mockResolvedValue([
        item('a', { tipAmount: 64.61, assignedTechIds: ['t1', 't2'], jobSerial: 2 }),
        item('b', { superStatus: 'canceled', jobSerial: 1 }),
        item('c', { tipAmount: 10, assignedTechIds: ['me'], jobTypeId: 'jt2' }),
        // Outside the period (the index is read with a day of margin).
        item('d', { tipAmount: 999, scheduledDate: '2026-09-28', scheduledEndDate: '2026-09-28' }),
        // Nobody on it.
        item('e', { tipAmount: 5, assignedTechIds: [] }),
      ]),
    };
    http = {
      getUserNamesBatch: jest.fn().mockResolvedValue([
        { id: 't1', firstName: 'Yeter', lastName: 'Mizrahi' },
        { id: 't2', firstName: 'Tom', lastName: 'Tech' },
        { id: 'me', firstName: 'Me', lastName: 'Myself' },
      ]),
      getContactNames: jest.fn(async (ids: string[]) => ids.map((id) => ({ id, firstName: 'Client', lastName: id }))),
    };
    const catalog = (rows: unknown[]) => ({ list: jest.fn().mockResolvedValue(rows) });
    const jobsReport = new JobsReportService(
      repository as never,
      { get: jest.fn() } as never,
      http as never,
      catalog([{ id: 'jt1', name: 'Car key' }, { id: 'jt2', name: 'Lockout' }]) as never,
      catalog([]) as never,
      catalog([]) as never,
      catalog([]) as never,
      catalog([]) as never,
      catalog([]) as never,
    );
    service = new TipsReportService(repository as never, jobsReport);
  });

  it('reads the period off the schedule index (every status) and gives one line a person', async () => {
    const page = await service.page(q(), caller());
    expect(repository.readReportWindow).toHaveBeenCalledWith('scheduled', '2026-09-01', '2026-09-27', expect.arrayContaining(['tipAmount', 'assignedTechIds']));
    const byId = Object.fromEntries(page.rows.map((r) => [r.techId, r]));
    expect(byId).toEqual({
      t1: { techId: 't1', name: 'Yeter Mizrahi', tips: 32.31, jobs: 2 },
      t2: { techId: 't2', name: 'Tom Tech', tips: 32.31, jobs: 1 },
      me: { techId: 'me', name: 'Me Myself', tips: 10, jobs: 1 },
    });
    expect(page).toMatchObject({ window: { from: '2026-09-01', to: '2026-09-27' }, money: true });
  });

  it('narrows by job type and client, picks rows by tech', async () => {
    expect((await service.page(q({ jobTypeId: 'jt2' }), caller())).rows.map((r) => r.techId)).toEqual(['me']);
    expect((await service.page(q({ contactId: 'c-b' }), caller())).rows).toEqual([{ techId: 't1', name: 'Yeter Mizrahi', tips: 0, jobs: 1 }]);
    expect((await service.page(q({ techId: 't2,me' }), caller())).rows.map((r) => r.techId).sort()).toEqual(['me', 't2']);
  });

  it('reads the window once a minute, whatever is opened or filtered', async () => {
    await service.page(q(), caller());
    await service.page(q({ techId: 't1' }), caller());
    await service.jobs(jq(), caller());
    expect(repository.readReportWindow).toHaveBeenCalledTimes(1);
    await service.page(q({ to: '2026-09-30' }), caller());
    expect(repository.readReportWindow).toHaveBeenCalledTimes(2);
  });

  it('withholds the money without financials.view', async () => {
    const page = await service.page(q(), caller(perms({ reports: { view: true } })));
    expect(page.money).toBe(false);
    expect(page.rows.every((r) => r.tips === null && r.jobs > 0)).toBe(true);
    const jobs = await service.jobs(jq(), caller(perms({ reports: { view: true } })));
    expect(jobs.rows.every((r) => r.total === null && r.tip === null)).toBe(true);
  });

  it('assigned_only sees their own line and their own jobs only', async () => {
    const own = perms({ reports: { view: true }, financials: { view: true } }, 'assigned_only');
    expect((await service.page(q(), caller(own))).rows.map((r) => r.techId)).toEqual(['me']);
    await expect(service.jobs(jq({ tech: 't1' }), caller(own))).rejects.toBeInstanceOf(ForbiddenException);
    expect((await service.jobs(jq({ tech: 'me' }), caller(own))).rows.map((r) => r.dealId)).toEqual(['c']);
  });

  describe('jobs — the row opened', () => {
    it('lists the person\'s jobs in creation order, the whole total and their share, names on the page', async () => {
      const page = await service.jobs(jq(), caller());
      expect(page.rows.map((r) => r.dealId)).toEqual(['b', 'a']);
      expect(page.rows[1]).toMatchObject({ jobNumber: 'A', client: 'Client c-a', jobType: 'Car key', total: 100, tip: 32.31, people: 2, date: '2026-09-12T10:00' });
      expect(page.pagination).toEqual({ page: 1, pageSize: 10, total: 2, pages: 1, from: 1, to: 2 });
      expect(page.sort).toEqual({ column: 'default', dir: 'asc' });
    });

    it('sorts and pages on the server', async () => {
      const page = await service.jobs(jq({ sort: 'tip', dir: 'desc', pageSize: '1' }), caller());
      expect(page.rows.map((r) => r.dealId)).toEqual(['a']);
      expect(page.pagination).toMatchObject({ total: 2, pages: 2, from: 1, to: 1 });
    });

    it('names only the page\'s clients unless the sort needs them all', async () => {
      await service.jobs(jq({ pageSize: '1' }), caller());
      expect(http.getContactNames.mock.calls.flatMap((c) => c[0])).toEqual(['c-b']);
      await service.jobs(jq({ sort: 'client' }), caller());
      expect(http.getContactNames.mock.calls.flatMap((c) => c[0]).sort()).toEqual(['c-a', 'c-b']);
    });

    it('is empty for a person the Tech filter hides, or with no jobs in the period', async () => {
      expect((await service.jobs(jq({ techId: 't2' }), caller())).rows).toEqual([]);
      expect((await service.jobs(jq({ tech: 'nobody' }), caller())).pagination.total).toBe(0);
    });
  });

  it('turns a window too large to read into a 400, and does not keep the failure', async () => {
    repository.readReportWindow.mockRejectedValue(new ReportWindowTooLargeError(150_000));
    await expect(service.page(q(), caller())).rejects.toBeInstanceOf(BadRequestException);
    repository.readReportWindow.mockResolvedValue([]);
    await expect(service.page(q(), caller())).resolves.toMatchObject({ rows: [] });
  });

  it('says so plainly when the schedule index is missing on this environment', async () => {
    repository.readReportWindow.mockRejectedValue(
      Object.assign(new Error('The table does not have the specified index: StatusScheduleIndex'), { name: 'ValidationException' }),
    );
    await expect(service.page(q(), caller())).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('Tips report query', () => {
  it('reads the period and the three filter groups', () => {
    expect(parseTipsReportQuery({ from: '2026-09-01', to: '2026-09-27', techId: 'a,b', jobTypeId: ['j1', 'j2'], contactId: 'c1' })).toEqual({
      from: '2026-09-01',
      to: '2026-09-27',
      filters: { techId: ['a', 'b'], jobTypeId: ['j1', 'j2'], contactId: ['c1'] },
    });
    expect(parseTipsReportQuery({ from: '2026-09-30' })).toEqual({ from: '2026-09-30', to: '2026-09-30', filters: {} });
  });

  it('refuses a bad period', () => {
    expect(() => parseTipsReportQuery({ from: 'today' })).toThrow('from must be a YYYY-MM-DD date');
    expect(() => parseTipsReportQuery({ from: '2026-09-02', to: '2026-09-01' })).toThrow('to is before from');
    expect(() => parseTipsReportQuery({ from: '2025-01-01', to: '2026-09-01' })).toThrow('at most 366 days');
    expect(() => parseTipsReportQuery({ from: '2026-09-01', techId: 'a b' })).toThrow('is not an id');
  });

  it('reads a person\'s jobs query: who, sort, direction, page', () => {
    expect(parseTipsReportJobsQuery({ from: '2026-09-01', tech: 't1' })).toMatchObject({ tech: 't1', sort: 'default', dir: 'asc', page: 1, pageSize: 10 });
    expect(parseTipsReportJobsQuery({ from: '2026-09-01', tech: 't1', sort: 'tip', dir: 'desc', page: '3', pageSize: '20' })).toMatchObject({
      sort: 'tip',
      dir: 'desc',
      page: 3,
      pageSize: 20,
    });
    expect(() => parseTipsReportJobsQuery({ from: '2026-09-01' })).toThrow('tech must be a user id');
    expect(() => parseTipsReportJobsQuery({ from: '2026-09-01', tech: 't1', sort: 'profit' })).toThrow('unknown column');
    expect(() => parseTipsReportJobsQuery({ from: '2026-09-01', tech: 't1', dir: 'up' })).toThrow('dir must be asc or desc');
    expect(() => parseTipsReportJobsQuery({ from: '2026-09-01', tech: 't1', pageSize: '5000' })).toThrow('pageSize must be');
  });
});

describe('TipsReportController', () => {
  it('is registered ahead of DealsController on report/tips', () => {
    const controllers: unknown[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, DealsModule);
    expect(controllers.indexOf(TipsReportController)).toBeGreaterThanOrEqual(0);
    expect(controllers.indexOf(TipsReportController)).toBeLessThan(controllers.indexOf(DealsController));
    expect(Reflect.getMetadata(PATH_METADATA, TipsReportController)).toBe('report/tips');
  });

  it('wraps the report and a person\'s jobs in the envelope', async () => {
    const svc = { page: jest.fn().mockResolvedValue({ rows: [] }), jobs: jest.fn().mockResolvedValue({ rows: [1] }) };
    const controller = new TipsReportController(svc as never);
    const user = createMockJwtUser();
    await expect(controller.page({ from: '2026-09-01' } as never, user, {} as never)).resolves.toEqual({ success: true, data: { rows: [] } });
    await expect(controller.jobs({ from: '2026-09-01', tech: 't1' } as never, user, {} as never)).resolves.toEqual({ success: true, data: { rows: [1] } });
    expect(svc.page).toHaveBeenCalledWith({ from: '2026-09-01' }, { user, perms: {} });
  });

  it('guards both routes with reports.view', () => {
    const guard = (name: 'page' | 'jobs') =>
      Reflect.getMetadataKeys(TipsReportController.prototype[name]).map((k) => [k, Reflect.getMetadata(k, TipsReportController.prototype[name])]);
    for (const name of ['page', 'jobs'] as const) {
      expect(JSON.stringify(guard(name))).toContain('reports');
    }
  });
});
