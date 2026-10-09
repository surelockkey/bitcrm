import { CommissionReportController } from 'src/commission-report/commission-report.controller';
import { createMockJwtUser } from '../mocks';

describe('CommissionReportController', () => {
  const service = {
    report: jest.fn().mockResolvedValue({ count: 0 }),
    exportCsv: jest.fn().mockResolvedValue({ filename: 'commissions_standard_closed_2026-09-01_2026-09-07.csv', csv: 'Job Id\r\nTotals:0' }),
  };
  const controller = new CommissionReportController(service as never);
  const user = createMockJwtUser({ id: 'u-1' });
  const perms = (scope?: string, superAdmin = false, financials = false) =>
    ({
      permissions: { commission: { view: true }, ...(financials && { financials: { view: true } }) },
      dataScope: scope ? { commission: scope } : {},
      isSystemRole: superAdmin,
      roleName: superAdmin ? 'Super Admin' : 'Technician',
    }) as never;

  beforeEach(() => jest.clearAllMocks());

  it('passes the caller’s commission scope down', async () => {
    const query = { from: '2026-09-01' };
    await expect(controller.report(query, user, perms('all'))).resolves.toEqual({ success: true, data: { count: 0 } });
    expect(service.report).toHaveBeenCalledWith(query, user, 'all', false);
    await controller.report(query, user, perms('assigned_only'));
    expect(service.report).toHaveBeenLastCalledWith(query, user, 'assigned_only', false);
  });

  it('no scope configured means the most restrictive one; Super Admin sees all', async () => {
    await controller.report({ from: '2026-09-01' }, user, perms());
    expect(service.report).toHaveBeenLastCalledWith(expect.anything(), user, 'assigned_only', false);
    await controller.report({ from: '2026-09-01' }, user, perms(undefined, true));
    expect(service.report).toHaveBeenLastCalledWith(expect.anything(), user, 'all', true);
  });

  it('amounts only with financials.view — for the page and for the export', async () => {
    await controller.report({ from: '2026-09-01' }, user, perms('all', false, true));
    expect(service.report).toHaveBeenLastCalledWith(expect.anything(), user, 'all', true);
    await controller.report({ from: '2026-09-01' }, user, perms('all'));
    expect(service.report).toHaveBeenLastCalledWith(expect.anything(), user, 'all', false);
    const res = { setHeader: jest.fn() };
    await controller.export({ from: '2026-09-01' }, user, perms('all'), res as never);
    expect(service.exportCsv).toHaveBeenLastCalledWith(expect.anything(), user, 'all', false);
    await controller.export({ from: '2026-09-01' }, user, perms('all', false, true), res as never);
    expect(service.exportCsv).toHaveBeenLastCalledWith(expect.anything(), user, 'all', true);
  });

  it('exports a UTF-8 CSV attachment Excel opens as such', async () => {
    const res = { setHeader: jest.fn() };
    const body = await controller.export({ from: '2026-09-01' }, user, perms('all'), res as never);
    expect(body).toBe('﻿Job Id\r\nTotals:0');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="commissions_standard_closed_2026-09-01_2026-09-07.csv"',
    );
  });
});
