import { ForbiddenException } from '@nestjs/common';
import { PERMISSION_KEY } from '@bitcrm/shared';
import { DealDashboardController } from 'src/deals/dashboard/deal-dashboard.controller';

/**
 * Кожен віджет — свій грант `dashboard.view_*`, і його ендпоінт відмовляє
 * ролі без нього: прихований віджет не має віддавати числа через DevTools
 * (US-03-03). Гроші — лише з `financials.view`.
 */
describe('DealDashboardController', () => {
  const user = { id: 'u-me' } as never;
  const withMoney = { permissions: { financials: { view: true } } } as never;
  const noMoney = { permissions: { financials: { view: false } } } as never;
  const window = { from: '2026-09-14', to: '2026-09-28' };

  function make() {
    const service = {
      sales: jest.fn(async () => ({ days: [], total: 0, net: 0 })),
      shares: jest.fn(async () => ({ slices: [] })),
      scoreboard: jest.fn(async () => ({ rows: [] })),
      today: jest.fn(async () => ({ jobsDone: 0, jobsCanceled: 0, jobsCreated: 0 })),
      jobsNow: jest.fn(async () => ({ byStatus: {} })),
    };
    return { service, controller: new DealDashboardController(service as never) };
  }

  it.each([
    ['sales', 'view_sales'],
    ['topSources', 'view_top_sources'],
    ['topJobTypes', 'view_top_job_types'],
    ['serviceAreas', 'view_service_areas'],
    ['techScoreboard', 'view_tech_scoreboard'],
    ['dispatchScoreboard', 'view_dispatch_scoreboard'],
    ['today', 'view_today'],
    ['jobsNow', 'view_jobs'],
  ])('%s is guarded by its own grant, dashboard.%s', (method, action) => {
    const handler = (DealDashboardController.prototype as unknown as Record<string, object>)[method];

    expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toEqual({ resource: 'dashboard', action });
  });

  it('sales refuses a caller without financials.view — the widget is nothing but money', async () => {
    const { controller, service } = make();

    await expect(controller.sales(window, user, noMoney)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.sales).not.toHaveBeenCalled();
  });

  it('sales answers a caller with financials.view', async () => {
    const { controller, service } = make();

    await controller.sales(window, user, withMoney);

    expect(service.sales).toHaveBeenCalledWith(window, user, { fresh: false });
  });

  it('a scoreboard carries amounts only with financials.view', async () => {
    const { controller, service } = make();

    await controller.techScoreboard(window, user, noMoney);
    await controller.dispatchScoreboard(window, user, withMoney);

    expect(service.scoreboard).toHaveBeenNthCalledWith(1, 'tech', window, user, false, { fresh: false });
    expect(service.scoreboard).toHaveBeenNthCalledWith(2, 'dispatch', window, user, true, { fresh: false });
  });

  it('today leaves the sales out without financials.view', async () => {
    const { controller, service } = make();

    await controller.today({ day: '2026-09-28' }, user, noMoney);

    expect(service.today).toHaveBeenCalledWith('2026-09-28', user, false);
  });

  it('the pies ask for their own dimension', async () => {
    const { controller, service } = make();

    await controller.topSources(window, user);
    await controller.topJobTypes(window, user);
    await controller.serviceAreas(window, user);

    expect(service.shares.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['source', 'jobType', 'serviceArea']);
  });

  // Кнопка ↻ на картці: перерахувати знімок, а не прочитати нічний.
  it('refresh=1 rebuilds the snapshot; its absence reads it', async () => {
    const { controller, service } = make();

    await controller.topSources({ ...window, refresh: '1' }, user);
    await controller.topSources(window, user);
    await controller.sales({ ...window, refresh: '1' }, user, withMoney);

    expect(service.shares).toHaveBeenNthCalledWith(1, 'source', window, user, { fresh: true });
    expect(service.shares).toHaveBeenNthCalledWith(2, 'source', window, user, { fresh: false });
    expect(service.sales).toHaveBeenCalledWith(window, user, { fresh: true });
  });
});
