import { PERMISSION_KEY } from '@bitcrm/shared';
import { TimesheetReportController } from '../../../../../src/technicians/timeclock/report/timesheet-report.controller';

describe('TimesheetReportController', () => {
  const user = { id: 'admin-1', cognitoSub: 's', email: 'a@x.com', roleId: 'role-admin', department: 'HQ' };
  let service: { report: jest.Mock; entries: jest.Mock };
  let controller: TimesheetReportController;

  beforeEach(() => {
    service = { report: jest.fn().mockResolvedValue({ rows: [] }), entries: jest.fn().mockResolvedValue({ rows: [] }) };
    controller = new TimesheetReportController(service as never);
  });

  it.each(['page', 'entries'] as const)('%s is a report: reports.view', (handler) => {
    const meta = Reflect.getMetadata(PERMISSION_KEY, TimesheetReportController.prototype[handler]);
    expect(meta).toEqual({ resource: 'reports', action: 'view' });
  });

  it('parses the query before the service sees it', async () => {
    await controller.page({ from: '2026-09-01', to: '2026-09-27', job: 'with_job' }, user);
    expect(service.report).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-09-01', to: '2026-09-27', filters: { job: ['with_job'] }, sort: 'name', dir: 'desc' }),
      user,
    );
  });

  it('refuses a bad period with a 400, not a DynamoDB error', async () => {
    await expect(controller.page({ from: '2026-09-30', to: '2026-09-01' }, user)).rejects.toThrow('to is before from');
    expect(service.report).not.toHaveBeenCalled();
  });

  it('wraps the answer in the usual envelope', async () => {
    expect(await controller.entries({ userId: 'u1', from: '2026-09-01' }, user)).toEqual({ success: true, data: { rows: [] } });
  });
});
