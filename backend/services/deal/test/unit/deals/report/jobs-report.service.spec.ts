import { BadRequestException } from '@nestjs/common';
import { JOBS_REPORT_DEFAULT_SETTINGS, type ResolvedPermissions } from '@bitcrm/types';
import { JobsReportService, type ReportCaller } from 'src/deals/report/jobs-report.service';
import { ReportWindowTooLargeError } from 'src/deals/deals.repository';
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
  primaryPhone: '+12035551234',
  emailAddress: `${id}@example.com`,
  serviceAreaId: 'sa1',
  sourceId: 's1',
  ...over,
});

const perms = (grants: Record<string, Record<string, boolean>>, dealsScope = 'all'): ResolvedPermissions =>
  ({ roleId: 'r', roleName: 'Dispatcher', isSystemRole: false, permissions: grants, dataScope: { deals: dealsScope } }) as unknown as ResolvedPermissions;

const FULL = perms({ reports: { view: true }, financials: { view: true }, contacts: { view: true, view_numbers: true } });

describe('JobsReportService', () => {
  let repository: { readReportWindow: jest.Mock };
  let settings: { get: jest.Mock; put: jest.Mock };
  let http: { getUserNamesBatch: jest.Mock; getContactNames: jest.Mock; getContactsAsCaller: jest.Mock };
  let service: JobsReportService;
  const caller = (p: ResolvedPermissions = FULL, over: Partial<ReportCaller> = {}): ReportCaller => ({
    user: createMockJwtUser({ id: 'me' }),
    perms: p,
    authorization: 'Bearer token',
    ...over,
  });
  const q = (over: Partial<JobsReportQueryDto> = {}) => ({ by: 'end', from: '2026-09-01', to: '2026-09-27', ...over }) as JobsReportQueryDto;

  beforeEach(() => {
    repository = {
      readReportWindow: jest.fn().mockResolvedValue([
        item('a', { createdAt: '2026-09-01T15:00:00.000Z', totals: { total: 10 } }),
        item('b', { createdAt: '2026-09-03T15:00:00.000Z', superStatus: 'canceled', totals: { total: 0 }, assignedTechIds: [] }),
        item('c', { createdAt: '2026-09-02T15:00:00.000Z', totals: { total: 50 }, assignedTechIds: ['me'] }),
        // Outside the window on the end date (read with a margin by the index).
        item('d', { scheduledDate: '2026-09-28', scheduledEndDate: '2026-09-28' }),
        // Workiz estimate stub.
        item('e', { isStub: true }),
      ]),
    };
    settings = { get: jest.fn().mockResolvedValue({ ...JOBS_REPORT_DEFAULT_SETTINGS }), put: jest.fn() };
    http = {
      getUserNamesBatch: jest.fn().mockResolvedValue([
        { id: 'tech-1', firstName: 'Sam', lastName: 'Tech' },
        { id: 'disp-1', firstName: 'Tess', lastName: 'Disp' },
      ]),
      getContactNames: jest.fn(async (ids: string[]) => ids.map((id) => ({ id, firstName: 'Client', lastName: id }))),
      getContactsAsCaller: jest.fn().mockResolvedValue([]),
    };
    const catalog = (rows: unknown[]) => ({ list: jest.fn().mockResolvedValue(rows) });
    service = new JobsReportService(
      repository as never,
      settings as never,
      http as never,
      catalog([{ id: 'jt1', name: 'Car key' }]) as never,
      catalog([{ id: 's1', name: 'GMB' }]) as never,
      catalog([]) as never,
      catalog([]) as never,
      catalog([{ id: 'sa1', name: 'SURE LOCK CT' }]) as never,
      catalog([]) as never,
    );
  });

  it('reads the window of the chosen date and lists it newest-created first, stubs and strays left out', async () => {
    const page = await service.page(q(), caller());
    expect(repository.readReportWindow).toHaveBeenCalledWith('end', '2026-09-01', '2026-09-27', expect.any(Array));
    expect(page.rows.map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(page.pagination).toEqual({ page: 1, pageSize: 50, total: 3, pages: 1, from: 1, to: 3 });
    expect(page.window).toEqual({ by: 'end', from: '2026-09-01', to: '2026-09-27' });
    expect(page.rows[0]).toMatchObject({ type: 'Car key', source: 'GMB', serviceArea: 'SURE LOCK CT', createdBy: 'Tess Disp', client: 'Client c-b' });
    expect(page.rows[2].tech).toEqual(['Sam Tech']);
  });

  it('opens on the account\'s "By:" when the query names none', async () => {
    settings.get.mockResolvedValue({ ...JOBS_REPORT_DEFAULT_SETTINGS, by: 'created' });
    const page = await service.page(q({ by: undefined }), caller());
    expect(repository.readReportWindow).toHaveBeenCalledWith('created', '2026-09-01', '2026-09-27', expect.any(Array));
    expect(page.window.by).toBe('created');
  });

  it('filters, sorts on any column and pages on the server', async () => {
    const page = await service.page(q({ status: 'done', sort: 'total', dir: 'desc', pageSize: '1' }), caller());
    expect(page.rows.map((r) => r.id)).toEqual(['c']);
    expect(page.pagination).toMatchObject({ total: 2, pages: 2, from: 1, to: 1 });
    const next = await service.page(q({ status: 'done', sort: 'total', dir: 'desc', pageSize: '1', page: '2' }), caller());
    expect(next.rows.map((r) => r.id)).toEqual(['a']);
  });

  it('reads the window once a minute, whatever the page, filter or sort', async () => {
    await service.page(q(), caller());
    await service.page(q({ page: '2', status: 'done', sort: 'client' }), caller());
    expect(repository.readReportWindow).toHaveBeenCalledTimes(1);
    await service.page(q({ by: 'created' }), caller());
    expect(repository.readReportWindow).toHaveBeenCalledTimes(2);
  });

  it('names only the page\'s clients unless the sort or the search needs them all', async () => {
    await service.page(q({ pageSize: '1' }), caller());
    expect(http.getContactNames).toHaveBeenCalledTimes(1);
    expect(http.getContactNames.mock.calls[0][0]).toEqual(['c-b']);
  });

  it('searches the named rows', async () => {
    const page = await service.page(q({ q: 'client c-c' }), caller());
    expect(page.rows.map((r) => r.id)).toEqual(['c']);
  });

  it('shows an assigned_only caller only their own jobs', async () => {
    const page = await service.page(q(), caller(perms({ reports: { view: true } }, 'assigned_only')));
    expect(page.rows.map((r) => r.id)).toEqual(['c']);
  });

  it('withholds money and numbers the caller may not see — and will not sort on them', async () => {
    const page = await service.page(q({ sort: 'total', dir: 'asc' }), caller(perms({ reports: { view: true } })));
    expect(page.money).toBe(false);
    expect(page.sort.column).toBe('created');
    expect(page.rows.every((r) => r.total === undefined && r.phone === undefined && r.phoneMasked)).toBe(true);
  });

  it('asks crm, as the caller, for the number and email of jobs that carry none', async () => {
    repository.readReportWindow.mockResolvedValue([item('n', { primaryPhone: undefined, emailAddress: undefined })]);
    http.getContactsAsCaller.mockResolvedValue([{ id: 'c-n', phones: ['+12035550000'], emails: ['n@x.com'] }]);
    const page = await service.page(q(), caller());
    expect(http.getContactsAsCaller).toHaveBeenCalledWith(['c-n'], 'Bearer token');
    expect(page.rows[0]).toMatchObject({ phone: '+12035550000', email: 'n@x.com' });
  });

  it('turns a window too large to read into a 400 that says to shorten it', async () => {
    repository.readReportWindow.mockRejectedValue(new ReportWindowTooLargeError(150_000));
    await expect(service.page(q(), caller())).rejects.toBeInstanceOf(BadRequestException);
    // …and does not keep the failure: the next try reads again.
    repository.readReportWindow.mockResolvedValue([]);
    await expect(service.page(q(), caller())).resolves.toMatchObject({ rows: [] });
  });

  it('says so plainly when the EndIndex is not built yet on this environment', async () => {
    repository.readReportWindow.mockRejectedValue(
      Object.assign(new Error('The table does not have the specified index: EndIndex'), { name: 'ValidationException' }),
    );
    await expect(service.page(q(), caller())).rejects.toThrow('"By: Job end date" is not available yet');
  });

  describe('export', () => {
    const collect = () => {
      const chunks: string[] = [];
      return { chunks, sink: { write: (c: string) => void chunks.push(c) } };
    };

    it('writes every row of the query, the account\'s visible columns, in the report order', async () => {
      settings.get.mockResolvedValue({ by: 'end', columns: ['jobNumber', 'status', 'total'] });
      const { chunks, sink } = collect();
      const res = await service.exportCsv(q({ pageSize: '1' }), caller(), sink);
      expect(res).toEqual({ rows: 3, columns: ['jobNumber', 'status', 'total'], by: 'end' });
      expect(chunks.join('')).toBe('Job #,Status,Total\r\nB,Canceled,0.00\r\nC,Done,50.00\r\nA,Done,10.00\r\n');
    });

    it('takes the columns asked for, and drops Total without financials.view', async () => {
      const { chunks, sink } = collect();
      await service.exportCsv(q({ columns: 'total,jobNumber' }), caller(perms({ reports: { view: true } })), sink);
      expect(chunks[0]).toBe('Job #\r\n');
    });

    it('fails before the first byte on a bad query', async () => {
      const { chunks, sink } = collect();
      await expect(service.exportCsv(q({ from: 'yesterday' }), caller(), sink)).rejects.toBeInstanceOf(BadRequestException);
      expect(chunks).toEqual([]);
    });
  });

  describe('settings', () => {
    it('saves the columns in the report order, and keeps at least one', async () => {
      await expect(service.saveSettings({ columns: ['total', 'jobNumber'] }, createMockJwtUser({ id: 'u1' }))).resolves.toEqual({
        columns: ['jobNumber', 'total'],
        by: 'end',
      });
      expect(settings.put).toHaveBeenCalledWith({ columns: ['jobNumber', 'total'], by: 'end' }, 'u1');
      await expect(service.saveSettings({ columns: [] }, createMockJwtUser())).rejects.toThrow('At least one column');
      await expect(service.saveSettings({ columns: ['profit'] }, createMockJwtUser())).rejects.toThrow('Unknown columns: profit');
      await expect(service.saveSettings({ by: 'closed' }, createMockJwtUser())).rejects.toThrow('by must be one of');
    });
  });
});
