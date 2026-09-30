import { DataScope, type JwtUser, type TimeClockEntry } from '@bitcrm/types';
import { TimesheetReportService } from '../../../../../src/technicians/timeclock/report/timesheet-report.service';
import { parseTimesheetReportQuery } from '../../../../../src/technicians/timeclock/report/timesheet-report.query';

const admin: JwtUser = { id: 'admin-1', cognitoSub: 's', email: 'a@x.com', roleId: 'role-admin', department: 'HQ' };

function perms(financials: boolean) {
  return {
    roleId: 'role-x',
    roleName: 'Role X',
    isSystemRole: true,
    permissions: { reports: { view: true }, financials: { view: financials } },
    dataScope: { technicians: DataScope.ALL },
    dealStageTransitions: [],
    hasOverrides: false,
  };
}

let seq = 0;
function e(userId: string, startedAt: string, endedAt?: string, over: Partial<TimeClockEntry> = {}): TimeClockEntry {
  seq += 1;
  return {
    id: `tc-${seq}`,
    userId,
    startedAt,
    ...(endedAt ? { endedAt, minutes: Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 60_000) } : {}),
    source: 'mobile',
    createdAt: startedAt,
    updatedAt: endedAt ?? startedAt,
    ...over,
  };
}

describe('TimesheetReportService', () => {
  let repo: {
    listStartedBetween: jest.Mock;
    listByUserInRange: jest.Mock;
    peopleByIds: jest.Mock;
    openUserIds: jest.Mock;
  };
  let users: { getResolvedPermissions: jest.Mock };
  let service: TimesheetReportService;

  const month: TimeClockEntry[] = [
    e('chris', '2026-09-02T12:00:00.000Z', '2026-09-02T20:00:00.000Z', { laborCostPerHour: 40 }),
    e('yeter', '2026-09-03T13:00:00.000Z', '2026-09-03T15:00:00.000Z', { dealId: 'd1' }),
    e('yeter', '2026-09-03T15:00:00.000Z', '2026-09-03T16:00:00.000Z', { dealId: 'd1' }),
    e('sales', '2026-09-04T17:23:00.000Z'),
  ];

  beforeEach(() => {
    repo = {
      listStartedBetween: jest.fn().mockImplementation(async (m: string) => (m === '2026-09' ? month : [])),
      listByUserInRange: jest.fn().mockResolvedValue([]),
      peopleByIds: jest.fn().mockImplementation(async (ids: string[]) => {
        const all: Record<string, { id: string; firstName: string; lastName: string }> = {
          chris: { id: 'chris', firstName: 'Chris', lastName: 'Ray' },
          yeter: { id: 'yeter', firstName: 'Yeter', lastName: 'Mizrahi' },
          sales: { id: 'sales', firstName: 'Sales', lastName: 'Platinum' },
        };
        return new Map(ids.filter((id) => all[id]).map((id) => [id, all[id]]));
      }),
      openUserIds: jest.fn().mockResolvedValue(new Set(['yeter', 'sales'])),
    };
    users = { getResolvedPermissions: jest.fn().mockResolvedValue(perms(true)) };
    service = new TimesheetReportService(repo as never, users as never);
  });

  it('reads each account month of the period off the index, between the Eastern day boundaries', async () => {
    await service.report(parseTimesheetReportQuery({ from: '2026-08-30', to: '2026-09-27' }), admin);
    expect(repo.listStartedBetween.mock.calls).toEqual([
      ['2026-08', '2026-08-30T04:00:00.000Z', '2026-09-28T04:00:00.000Z'],
      ['2026-09', '2026-08-30T04:00:00.000Z', '2026-09-28T04:00:00.000Z'],
    ]);
  });

  it('gives one line per person, named, with the clocked-in tag and the total row', async () => {
    const page = await service.report(parseTimesheetReportQuery({ from: '2026-09-01', to: '2026-09-27' }), admin);
    expect(page.rows.map((r) => [r.name, r.clockedIn, r.minutes, r.cost, r.jobs])).toEqual([
      ['Yeter Mizrahi', true, 180, 0, 1],
      ['Sales Platinum', true, 0, 0, 0],
      ['Chris Ray', false, 480, 320, 0],
    ]);
    expect(page.total).toEqual({ minutes: 660, grossMinutes: 660, cost: 320, grossCost: 320, jobs: 1, entries: 4 });
    expect(page.money).toBe(true);
    expect(page.rows[0]).not.toHaveProperty('jobIds');
  });

  it('leaves the money out without financials.view', async () => {
    users.getResolvedPermissions.mockResolvedValue(perms(false));
    const page = await service.report(parseTimesheetReportQuery({ from: '2026-09-01', to: '2026-09-27' }), admin);
    expect(page.money).toBe(false);
    expect(page.rows.every((r) => r.cost === undefined && r.grossCost === undefined)).toBe(true);
    expect(page.total.cost).toBeUndefined();
  });

  // Workiz: searching "CT -" leaves two people and a total of just them.
  it('narrows the lines and the total by the search', async () => {
    const page = await service.report(parseTimesheetReportQuery({ from: '2026-09-01', to: '2026-09-27', q: 'ray' }), admin);
    expect(page.rows.map((r) => r.name)).toEqual(['Chris Ray']);
    expect(page.total).toMatchObject({ minutes: 480, cost: 320, jobs: 0, entries: 1 });
  });

  it('applies the Team and Jobs filters before anything is counted', async () => {
    const withJob = await service.report(
      parseTimesheetReportQuery({ from: '2026-09-01', to: '2026-09-27', job: 'with_job' }),
      admin,
    );
    expect(withJob.rows.map((r) => r.userId)).toEqual(['yeter']);
    const team = await service.report(
      parseTimesheetReportQuery({ from: '2026-09-01', to: '2026-09-27', userId: 'chris,sales' }),
      admin,
    );
    expect(team.rows.map((r) => r.userId).sort()).toEqual(['chris', 'sales']);
    expect(repo.peopleByIds).toHaveBeenLastCalledWith(expect.arrayContaining(['chris', 'sales']));
  });

  it('pages and sorts on the server', async () => {
    const page = await service.report(
      parseTimesheetReportQuery({ from: '2026-09-01', to: '2026-09-27', sort: 'hours', dir: 'desc', pageSize: '2', page: '1' }),
      admin,
    );
    expect(page.rows.map((r) => r.userId)).toEqual(['chris', 'yeter']);
    expect(page.pagination).toMatchObject({ total: 3, pages: 2, from: 1, to: 2 });
    expect(page.total.entries).toBe(4);
  });

  it('prints someone BitCRM no longer has by their id', async () => {
    repo.peopleByIds.mockResolvedValue(new Map());
    const page = await service.report(parseTimesheetReportQuery({ from: '2026-09-01', to: '2026-09-27' }), admin);
    expect(page.rows.map((r) => r.name).sort()).toEqual(['chris', 'sales', 'yeter']);
  });

  describe('entries', () => {
    it('reads the person\'s own partition with the Eastern bounds and lists newest first', async () => {
      repo.listByUserInRange.mockResolvedValue([
        e('yeter', '2026-09-03T13:00:00.000Z', '2026-09-03T15:00:00.000Z', { dealId: 'd1' }),
        e('yeter', '2026-09-28T03:30:00.000Z', '2026-09-28T04:30:00.000Z'), // 27.09 23:30 Eastern — in
        e('yeter', '2026-09-28T04:00:00.000Z'), // 28.09 00:00 Eastern — out
      ]);
      const page = await service.entries({ userId: 'yeter', from: '2026-09-01', to: '2026-09-27' }, admin);
      expect(repo.listByUserInRange).toHaveBeenCalledWith('yeter', '2026-09-01T04:00:00.000Z', '2026-09-28T03:59:59.999Z');
      expect(page.rows.map((r) => r.startedAt)).toEqual(['2026-09-28T03:30:00.000Z', '2026-09-03T13:00:00.000Z']);
      expect(page).toMatchObject({ name: 'Yeter Mizrahi', clockedIn: true, money: true });
      expect(page.total).toEqual({ minutes: 180, grossMinutes: 180, cost: 0, grossCost: 0 });
    });

    it('carries the Jobs filter into the opened row', async () => {
      repo.listByUserInRange.mockResolvedValue([
        e('yeter', '2026-09-03T13:00:00.000Z', '2026-09-03T15:00:00.000Z', { dealId: 'd1' }),
        e('yeter', '2026-09-04T13:00:00.000Z', '2026-09-04T15:00:00.000Z'),
      ]);
      const page = await service.entries({ userId: 'yeter', from: '2026-09-01', to: '2026-09-27', job: ['without_job'] }, admin);
      expect(page.rows).toHaveLength(1);
      expect(page.rows[0].dealId).toBeUndefined();
    });
  });
});
