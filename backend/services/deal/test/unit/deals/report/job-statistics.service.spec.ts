import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { JOBS_REPORT_DEFAULT_SETTINGS, type ResolvedPermissions } from '@bitcrm/types';
import { DealsModule } from 'src/deals/deals.module';
import { DealsController } from 'src/deals/deals.controller';
import { ReportWindowTooLargeError } from 'src/deals/deals.repository';
import { JobsReportService, type ReportCaller } from 'src/deals/report/jobs-report.service';
import { JobStatisticsController } from 'src/deals/report/job-statistics.controller';
import { JobStatisticsService, statisticsAccess } from 'src/deals/report/job-statistics.service';
import type { JobsReportQueryDto } from 'src/deals/report/jobs-report.query';
import { createMockJwtUser } from '../../mocks';

/** A deal row as the window read projects it. */
const item = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  status: 'active',
  dealNumber: id.toUpperCase(),
  contactId: `c-${id}`,
  tagIds: [],
  jobTypeId: 'jt1',
  createdAt: '2026-09-10T15:00:00.000Z',
  scheduledDate: '2026-09-12',
  scheduledEndDate: '2026-09-12',
  scheduledTimeSlot: '10:00-11:00',
  superStatus: 'done',
  assignedTechIds: ['tech-1'],
  createdBy: 'disp-1',
  totals: { total: 100 },
  serviceAreaId: 'sa1',
  address: { city: 'Denison', zip: '75020' },
  sourceId: 's1',
  parts: 10,
  commissionSnapshot: { companyProfit: 45 },
  ...over,
});

const perms = (grants: Record<string, Record<string, boolean>>, dealsScope = 'all'): ResolvedPermissions =>
  ({ roleId: 'r', roleName: 'Dispatcher', isSystemRole: false, permissions: grants, dataScope: { deals: dealsScope } }) as unknown as ResolvedPermissions;

const FULL = perms({ reports: { view: true }, financials: { view: true } });

describe('statisticsAccess', () => {
  it('shows money with financials.view, and profit too unless View Profit is switched off', () => {
    expect(statisticsAccess(FULL)).toMatchObject({ money: true, profit: true });
    expect(statisticsAccess(perms({ reports: { view: true, view_profit: false }, financials: { view: true } }))).toMatchObject({
      money: true,
      profit: false,
    });
    // View Profit alone shows nothing: no money at all without financials.view.
    expect(statisticsAccess(perms({ reports: { view: true, view_profit: true } }))).toMatchObject({ money: false, profit: false });
  });

  it('closes a tab only on an explicit false — a role saved before the grants keeps every tab', () => {
    expect(statisticsAccess(FULL).tabs).toEqual(['sources', 'tech', 'area', 'dispatcher', 'jobTypes']);
    expect(
      statisticsAccess(perms({ reports: { view: true, view_ad_statistics: false, view_dispatch_statistics: false, view_tech_statistics: true } })).tabs,
    ).toEqual(['tech', 'area', 'jobTypes']);
  });

  it('lets Super Admin see everything whatever its matrix says', () => {
    const superAdmin = { roleName: 'Super Admin', isSystemRole: true, permissions: { reports: { view_profit: false } }, dataScope: {} } as unknown as ResolvedPermissions;
    expect(statisticsAccess(superAdmin)).toEqual({ money: true, profit: true, tabs: ['sources', 'tech', 'area', 'dispatcher', 'jobTypes'] });
  });
});

describe('JobStatisticsService', () => {
  let repository: { readReportWindow: jest.Mock };
  let http: { getUserNamesBatch: jest.Mock; getContactNames: jest.Mock; getContactsAsCaller: jest.Mock };
  let commissions: { build: jest.Mock };
  let service: JobStatisticsService;
  const caller = (p: ResolvedPermissions = FULL): ReportCaller => ({ user: createMockJwtUser({ id: 'me' }), perms: p });
  const q = (over: Partial<JobsReportQueryDto> = {}) => ({ from: '2026-09-01', to: '2026-09-27', ...over }) as JobsReportQueryDto;

  beforeEach(() => {
    repository = {
      readReportWindow: jest.fn().mockResolvedValue([
        item('a'),
        item('b', { superStatus: 'canceled', assignedTechIds: [], commissionSnapshot: undefined, parts: 0 }),
        item('c', { assignedTechIds: ['me'], totals: { total: 50 }, commissionSnapshot: { companyProfit: 20 } }),
        // Done here: no Workiz row — its profit is the Commissions report's.
        item('n', { commissionSnapshot: undefined, totals: { total: 200 }, parts: 0 }),
        // Outside the period on the end date (read with a margin by the index).
        item('d', { scheduledDate: '2026-09-28', scheduledEndDate: '2026-09-28' }),
        // Workiz estimate stub.
        item('e', { isStub: true }),
      ]),
    };
    http = {
      getUserNamesBatch: jest.fn().mockResolvedValue([
        { id: 'tech-1', firstName: 'Sam', lastName: 'Tech' },
        { id: 'disp-1', firstName: 'Tess', lastName: 'Disp' },
      ]),
      getContactNames: jest.fn().mockResolvedValue([]),
      getContactsAsCaller: jest.fn().mockResolvedValue([]),
    };
    commissions = {
      build: jest.fn(async (items: Array<{ id: string }>) => ({
        rows: items.map((i) => ({ dealId: i.id, companyProfit: 88.5, parts: 7 })),
        warnings: [],
      })),
    };
    const catalog = (rows: unknown[]) => ({ list: jest.fn().mockResolvedValue(rows) });
    const jobsReport = new JobsReportService(
      repository as never,
      { get: jest.fn().mockResolvedValue(JOBS_REPORT_DEFAULT_SETTINGS), put: jest.fn() } as never,
      http as never,
      catalog([{ id: 'jt1', name: 'Car key' }]) as never,
      catalog([{ id: 's1', name: 'GMB', description: 'SURE TX DENISON GMB' }]) as never,
      catalog([]) as never,
      catalog([]) as never,
      catalog([{ id: 'sa1', name: 'SURE LOCK SHERMAN TX' }]) as never,
      catalog([]) as never,
    );
    service = new JobStatisticsService(repository as never, jobsReport, commissions as never);
  });

  it('opens on "Closed" — the visit’s end — and reads that window with the money attributes', async () => {
    const s = await service.statistics(q(), caller());
    expect(repository.readReportWindow).toHaveBeenCalledWith('end', '2026-09-01', '2026-09-27', expect.arrayContaining(['commissionSnapshot', 'parts']));
    expect(s.window).toEqual({ by: 'end', from: '2026-09-01', to: '2026-09-27' });
    expect(s.kpis).toMatchObject({ all: 4, done: 3, canceled: 1, open: 0, gross: 350, profit: 153.5, techExpenses: 27 });
    expect(s.series).toHaveLength(27);
  });

  it('takes the profit of a job done here from its Commissions (Legacy) row', async () => {
    const s = await service.statistics(q(), caller());
    expect(commissions.build).toHaveBeenCalledTimes(1);
    expect(commissions.build.mock.calls[0][0].map((i: { id: string }) => i.id)).toEqual(['n']);
    expect(s.profitSources).toEqual({ workiz: 2, computed: 1 });
    expect(s.warnings).toEqual([]);
  });

  it('says so when that profit cannot be computed, and counts none for it', async () => {
    commissions.build.mockRejectedValue(new Error('user-service down'));
    const s = await service.statistics(q(), caller());
    expect(s.kpis.profit).toBe(65);
    expect(s.warnings).toEqual(['The profit of 1 job(s) done in BitCRM could not be computed — they count no profit.']);
    // Only those who see profit are told.
    const noProfit = await service.statistics(q(), caller(perms({ reports: { view: true, view_profit: false }, financials: { view: true } })));
    expect(noProfit.warnings).toEqual([]);
  });

  it('passes the Commissions report’s own warnings on', async () => {
    commissions.build.mockResolvedValue({ rows: [{ dealId: 'n', companyProfit: 1, parts: 0 }], warnings: ['Technician rates could not be read'] });
    expect((await service.statistics(q(), caller())).warnings).toEqual(['Technician rates could not be read']);
  });

  it('names the rows: ad-group description, the team, the area, the creator', async () => {
    const s = await service.statistics(q(), caller());
    expect(s.sources!.rows[0]).toMatchObject({ label: 'SURE TX DENISON GMB', kind: 'ad', all: 4 });
    expect(s.tech!.rows.map((r) => r.label)).toEqual(['Sam Tech', '', 'Unknown user']);
    expect(s.area!.metro.rows[0]).toMatchObject({ label: 'SURE LOCK SHERMAN TX', all: 4 });
    expect(s.dispatcher!.rows[0]).toMatchObject({ label: 'Tess Disp', all: 4 });
    expect(s.jobTypes!.rows[0]).toMatchObject({ label: 'Car key' });
  });

  it('reads a window once a minute, whatever the filters', async () => {
    await service.statistics(q(), caller());
    await service.statistics(q({ serviceAreaId: 'sa1' }), caller());
    await service.statistics(q({ tagId: 't1' }), caller());
    expect(repository.readReportWindow).toHaveBeenCalledTimes(1);
    expect(commissions.build).toHaveBeenCalledTimes(1);
  });

  it('filters like the Jobs report: a tag, a service area', async () => {
    repository.readReportWindow.mockResolvedValue([item('a', { tagIds: ['t1'] }), item('b', { serviceAreaId: 'sa2' })]);
    expect((await service.statistics(q({ tagId: 't1' }), caller())).kpis.all).toBe(1);
    expect((await service.statistics(q({ serviceAreaId: 'sa2' }), caller())).kpis.all).toBe(1);
  });

  it('counts only an assigned_only caller’s own jobs', async () => {
    const s = await service.statistics(q(), caller(perms({ reports: { view: true }, financials: { view: true } }, 'assigned_only')));
    expect(s.kpis).toMatchObject({ all: 1, done: 1, gross: 50 });
  });

  it('leaves out the money, the profit and closed tabs as the caller’s grants say', async () => {
    const s = await service.statistics(q(), caller(perms({ reports: { view: true, view_tech_statistics: false } })));
    expect(s.access).toEqual({ money: false, profit: false, tabs: ['sources', 'area', 'dispatcher', 'jobTypes'] });
    expect(s.tech).toBeUndefined();
    expect(s.kpis).not.toHaveProperty('gross');
    // The technicians' names are not even asked for.
    expect(http.getUserNamesBatch).toHaveBeenCalledWith(['disp-1']);
  });

  it('answers a too-long window with 400 and an unbuilt EndIndex with 503', async () => {
    repository.readReportWindow.mockRejectedValueOnce(new ReportWindowTooLargeError(150_000));
    await expect(service.statistics(q(), caller())).rejects.toBeInstanceOf(BadRequestException);
    repository.readReportWindow.mockRejectedValueOnce(Object.assign(new Error('The table does not have the specified index: EndIndex'), { name: 'ValidationException' }));
    await expect(service.statistics(q({ to: '2026-09-26' }), caller())).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('refuses a bad period', async () => {
    await expect(service.statistics(q({ from: 'yesterday' }), caller())).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.statistics(q({ from: '2025-01-01', to: '2026-09-27' }), caller())).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('JobStatisticsController', () => {
  it('is registered ahead of DealsController, at report/statistics', () => {
    const controllers: unknown[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, DealsModule);
    expect(controllers.indexOf(JobStatisticsController)).toBeGreaterThanOrEqual(0);
    expect(controllers.indexOf(JobStatisticsController)).toBeLessThan(controllers.indexOf(DealsController));
    expect(Reflect.getMetadata(PATH_METADATA, JobStatisticsController)).toBe('report/statistics');
  });

  it('wraps the statistics in the envelope', async () => {
    const svc = { statistics: jest.fn().mockResolvedValue({ kpis: {} }) };
    const controller = new JobStatisticsController(svc as never);
    const user = createMockJwtUser();
    await expect(controller.get({ from: '2026-09-01' } as never, user, {} as never)).resolves.toEqual({ success: true, data: { kpis: {} } });
    expect(svc.statistics).toHaveBeenCalledWith({ from: '2026-09-01' }, { user, perms: {} });
  });
});
