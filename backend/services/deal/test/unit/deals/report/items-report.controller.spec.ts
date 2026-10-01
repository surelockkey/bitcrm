import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DealsModule } from 'src/deals/deals.module';
import { DealsController } from 'src/deals/deals.controller';
import { ItemsReportController } from 'src/deals/report/items-report.controller';
import { createMockJwtUser } from '../../mocks';

describe('ItemsReportController', () => {
  it('is registered ahead of DealsController, or its GET /:id… routes would take /report/items', () => {
    const controllers: unknown[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, DealsModule);
    expect(controllers.indexOf(ItemsReportController)).toBeGreaterThanOrEqual(0);
    expect(controllers.indexOf(ItemsReportController)).toBeLessThan(controllers.indexOf(DealsController));
    expect(Reflect.getMetadata(PATH_METADATA, ItemsReportController)).toBe('report/items');
  });

  it('wraps the page and the jobs in the envelope, with the caller and their grants', async () => {
    const service = { page: jest.fn().mockResolvedValue({ rows: [] }), jobs: jest.fn().mockResolvedValue({ rows: [], item: null }) };
    const controller = new ItemsReportController(service as never);
    const user = createMockJwtUser();
    await expect(controller.page({ from: '2026-09-01' } as never, user, {} as never)).resolves.toEqual({ success: true, data: { rows: [] } });
    expect(service.page).toHaveBeenCalledWith({ from: '2026-09-01' }, { user, perms: {} });
    await expect(controller.jobs({ from: '2026-09-01', item: 'p1' } as never, user, {} as never)).resolves.toEqual({
      success: true,
      data: { rows: [], item: null },
    });
  });

  it('sends the CSV as an attachment named after the period', async () => {
    const service = { exportCsv: jest.fn().mockResolvedValue({ csv: 'Item\r\n', rows: 0, from: '2026-09-01', to: '2026-09-27' }) };
    const headers: Record<string, string> = {};
    const res = {
      statusCode: 0,
      body: '',
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      setHeader: (k: string, v: string) => (headers[k.toLowerCase()] = v),
      send(body: string) {
        this.body = body;
      },
    };
    await new ItemsReportController(service as never).export({ from: '2026-09-01' } as never, createMockJwtUser(), {} as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(headers['content-disposition']).toBe('attachment; filename="items-report-2026-09-01_2026-09-27.csv"');
    expect(res.body).toBe('Item\r\n');
  });
});
