import { BadRequestException } from '@nestjs/common';
import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { EventEmitter } from 'events';
import { DealsModule } from 'src/deals/deals.module';
import { DealsController } from 'src/deals/deals.controller';
import { SalesReportController } from 'src/deals/report/sales-report.controller';
import { createMockJwtUser } from '../../mocks';

/** Just enough of an express Response to watch a stream. */
function fakeResponse() {
  const res = new EventEmitter() as EventEmitter & Record<string, any>;
  res.headers = {} as Record<string, string>;
  res.body = '';
  res.ended = false;
  res.statusCode = 0;
  res.status = (code: number) => ((res.statusCode = code), res);
  res.setHeader = (k: string, v: string) => (res.headers[k.toLowerCase()] = v);
  res.write = (chunk: string) => ((res.body += chunk), true);
  res.end = () => (res.ended = true);
  res.destroy = jest.fn();
  return res;
}

describe('SalesReportController', () => {
  it('is registered ahead of DealsController, at /deals/report/sales', () => {
    const controllers: unknown[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, DealsModule);
    expect(controllers.indexOf(SalesReportController)).toBeGreaterThanOrEqual(0);
    expect(controllers.indexOf(SalesReportController)).toBeLessThan(controllers.indexOf(DealsController));
    expect(Reflect.getMetadata(PATH_METADATA, SalesReportController)).toBe('report/sales');
  });

  it('wraps the page in the envelope and hands crm the caller\'s token', async () => {
    const service = { page: jest.fn().mockResolvedValue({ rows: [] }) };
    const controller = new SalesReportController(service as never);
    const user = createMockJwtUser();
    await expect(controller.page({ from: '2026-09-01' } as never, user, {} as never, 'Bearer t')).resolves.toEqual({
      success: true,
      data: { rows: [] },
    });
    expect(service.page).toHaveBeenCalledWith({ from: '2026-09-01' }, { user, perms: {}, authorization: 'Bearer t' });
  });

  it('streams the CSV as an attachment', async () => {
    const service = {
      exportCsv: jest.fn(async (_q, _c, sink: { write: (s: string) => Promise<void> }) => {
        await sink.write('Job ID,Total\r\nTotal:,1.00\r\n');
        await sink.write('A1,1.00\r\n');
        return { rows: 1 };
      }),
    };
    const res = fakeResponse();
    await new SalesReportController(service as never).export({ from: '2026-09-01', to: '2026-09-30' } as never, createMockJwtUser(), {} as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="sales-report-2026-09-01_2026-09-30.csv"');
    expect(res.body).toBe('Job ID,Total\r\nTotal:,1.00\r\nA1,1.00\r\n');
    expect(res.ended).toBe(true);
  });

  it('lets an error before the first byte become an ordinary error response', async () => {
    const service = { exportCsv: jest.fn().mockRejectedValue(new BadRequestException('bad')) };
    const res = fakeResponse();
    await expect(
      new SalesReportController(service as never).export({} as never, createMockJwtUser(), {} as never, res as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(res.statusCode).toBe(0);
  });

  it('cuts the stream when it fails half-way, rather than send half a file as whole', async () => {
    const service = {
      exportCsv: jest.fn(async (_q, _c, sink: { write: (s: string) => Promise<void> }) => {
        await sink.write('Job ID\r\n');
        throw new Error('crm down');
      }),
    };
    const res = fakeResponse();
    await new SalesReportController(service as never).export({} as never, createMockJwtUser(), {} as never, res as never);
    expect(res.destroy).toHaveBeenCalled();
    expect(res.ended).toBe(false);
  });

  it('settings: read with reports.view, saved for the account', async () => {
    const service = {
      getSettings: jest.fn().mockResolvedValue({ columns: ['jobNumber'], by: 'scheduled' }),
      saveSettings: jest.fn().mockResolvedValue({ columns: ['total'], by: 'end' }),
    };
    const controller = new SalesReportController(service as never);
    await expect(controller.settings()).resolves.toEqual({ success: true, data: { columns: ['jobNumber'], by: 'scheduled' } });
    const user = createMockJwtUser();
    await expect(controller.saveSettings({ columns: ['total'], by: 'end' }, user)).resolves.toEqual({
      success: true,
      data: { columns: ['total'], by: 'end' },
    });
    expect(service.saveSettings).toHaveBeenCalledWith({ columns: ['total'], by: 'end' }, user);
  });
});
