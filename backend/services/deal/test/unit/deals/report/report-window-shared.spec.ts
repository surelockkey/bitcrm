/**
 * The reports' window reads are shared across tasks through Redis
 * (`ReportWindowCache`): two service instances — two ECS tasks — over one
 * Redis read DynamoDB once for the same window, and a different "By:" or
 * technician is a different entry.
 */
import { JOBS_REPORT_DEFAULT_SETTINGS, type ResolvedPermissions } from '@bitcrm/types';
import { ReportWindowCache } from 'src/common/cache/report-window-cache';
import { JobsReportService } from 'src/deals/report/jobs-report.service';
import { JobStatisticsService } from 'src/deals/report/job-statistics.service';
import { TaxReportService } from 'src/deals/report/tax-report.service';
import { CommissionReportService } from 'src/commission-report/commission-report.service';
import type { JobsReportQueryDto } from 'src/deals/report/jobs-report.query';
import { createMockJwtUser } from '../../mocks';

const FULL = {
  roleName: 'Super Admin',
  isSystemRole: true,
  permissions: { financials: { view: true }, reports: { view: true } },
  dataScope: {},
} as unknown as ResolvedPermissions;

function sharedRedis() {
  const store = new Map<string, Buffer>();
  return {
    store,
    service: {
      client: {
        getBuffer: jest.fn(async (k: string) => store.get(k) ?? null),
        set: jest.fn(async (k: string, v: Buffer) => void store.set(k, v)),
      },
    } as never,
  };
}

const row = (id: string, over: Record<string, unknown> = {}) => ({
  PK: `DEAL#${id}`,
  SK: 'METADATA',
  id,
  status: 'active',
  dealNumber: id,
  contactId: 'c1',
  superStatus: 'done',
  createdAt: '2026-08-20T12:00:00.000Z',
  scheduledDate: '2026-09-10',
  scheduledEndDate: '2026-09-10',
  totals: { total: 100, tax: 0, subtotal: 100 },
  assignedTechIds: ['t1'],
  ...over,
});

const catalog = () => ({ list: jest.fn().mockResolvedValue([]) });
const http = () => ({
  getUserNamesBatch: jest.fn().mockResolvedValue([]),
  getContactNames: jest.fn().mockResolvedValue([]),
  getContactsAsCaller: jest.fn().mockResolvedValue([]),
});

function jobsReport(repository: unknown, cache: ReportWindowCache): JobsReportService {
  return new JobsReportService(
    repository as never,
    { get: jest.fn().mockResolvedValue(JOBS_REPORT_DEFAULT_SETTINGS), put: jest.fn() } as never,
    http() as never,
    catalog() as never,
    catalog() as never,
    catalog() as never,
    catalog() as never,
    catalog() as never,
    catalog() as never,
    cache,
  );
}

const q = (over: Partial<JobsReportQueryDto> = {}) => ({ from: '2026-09-01', to: '2026-09-27', ...over }) as JobsReportQueryDto;
const caller = () => ({ user: createMockJwtUser({ id: 'me' }), perms: FULL });

describe('report windows shared across tasks', () => {
  it('Jobs report: the second task answers from the first task’s read; another "By:" reads again', async () => {
    const redis = sharedRedis();
    const repository = { readReportWindow: jest.fn().mockResolvedValue([row('a'), row('b')]) };
    const taskA = jobsReport(repository, new ReportWindowCache(redis.service));
    const taskB = jobsReport(repository, new ReportWindowCache(redis.service));

    const a = await taskA.page(q({ by: 'end' }), caller());
    const b = await taskB.page(q({ by: 'end' }), caller());

    expect(repository.readReportWindow).toHaveBeenCalledTimes(1);
    expect(b.rows.map((r) => r.id)).toEqual(a.rows.map((r) => r.id));
    expect([...redis.store.keys()][0]).toMatch(/^deal:report-window:v1:jobs:2026-09-01:2026-09-27:end:[0-9a-f]{8}$/);

    await taskB.page(q({ by: 'created' }), caller());
    expect(repository.readReportWindow).toHaveBeenCalledTimes(2);
  });

  it('Job Statistics: the window read is shared, its own projection its own entry', async () => {
    const redis = sharedRedis();
    const repository = { readReportWindow: jest.fn().mockResolvedValue([row('a', { commissionSnapshot: { companyProfit: 10 } })]) };
    const make = () => {
      const cache = new ReportWindowCache(redis.service);
      return new JobStatisticsService(repository as never, jobsReport(repository, cache), { build: jest.fn() } as never, cache);
    };

    await make().statistics(q(), caller());
    const s = await make().statistics(q(), caller());

    expect(repository.readReportWindow).toHaveBeenCalledTimes(1);
    expect(s.kpis.all).toBe(1);
    expect([...redis.store.keys()][0]).toContain(':stats:2026-09-01:2026-09-27:end:');
  });

  it('Tax report (Accrual): the window read is shared', async () => {
    const redis = sharedRedis();
    const repo = { window: jest.fn().mockResolvedValue([]), byIds: jest.fn() };
    const make = () =>
      new TaxReportService(
        repo as never,
        { paidByJob: jest.fn() } as never,
        { listAll: jest.fn().mockResolvedValue([]) } as never,
        { list: jest.fn().mockResolvedValue([]) } as never,
        new ReportWindowCache(redis.service),
      );
    const query = { basis: 'accrual' as const, by: 'end' as const, from: '2026-09-01', to: '2026-09-30' };

    await make().report(query, { user: createMockJwtUser(), perms: FULL });
    await make().report(query, { user: createMockJwtUser(), perms: FULL });

    expect(repo.window).toHaveBeenCalledTimes(1);
    expect([...redis.store.keys()][0]).toContain(':tax:2026-09-01:2026-09-30:end:');
  });

  it('Commissions: the period read is shared per "By:" and per technician; `fresh` reads again', async () => {
    const redis = sharedRedis();
    const repository = {
      findDoneByVisitStart: jest.fn().mockResolvedValue({ items: [], truncated: false }),
      findDoneByCreated: jest.fn().mockResolvedValue({ items: [], truncated: false }),
      findDoneByTech: jest.fn().mockResolvedValue({ items: [], truncated: false }),
    };
    const listAll = { listAll: jest.fn().mockResolvedValue([]) };
    const client = {
      ledgers: jest.fn(),
      commissionHistories: jest.fn(),
      userNames: jest.fn().mockResolvedValue(new Map()),
      contactNames: jest.fn().mockResolvedValue(new Map()),
    };
    const make = () =>
      new CommissionReportService(
        repository as never,
        client as never,
        listAll as never,
        listAll as never,
        listAll as never,
        listAll as never,
        listAll as never,
        new ReportWindowCache(redis.service),
      );
    const office = createMockJwtUser({ id: 'office' });
    const tech = createMockJwtUser({ id: 'tech-9' });
    const dto = { from: '2026-09-01', to: '2026-09-07' };

    await make().report(dto as never, office);
    await make().report(dto as never, office);
    expect(repository.findDoneByVisitStart).toHaveBeenCalledTimes(1);

    await make().report(dto as never, tech, 'assigned_only');
    await make().report(dto as never, tech, 'assigned_only');
    expect(repository.findDoneByTech).toHaveBeenCalledTimes(1);

    await make().report({ ...dto, fresh: '1' } as never, office);
    expect(repository.findDoneByVisitStart).toHaveBeenCalledTimes(2);
  });
});
