import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PERMISSION_KEY } from '@bitcrm/shared';
import { DealsModule } from 'src/deals/deals.module';
import { DealsController } from 'src/deals/deals.controller';
import { DispatchMapController } from 'src/deals/map/dispatch-map.controller';
import { createMockDeal, createMockJwtUser } from '../mocks';

/**
 * `GET /deals/map` — the dispatch map's one read. Lives under the deals prefix
 * AHEAD of DealsController, whose `GET /:id` would otherwise take `/map` and
 * answer "Deal map not found" (which is exactly what the web reads as "this
 * deal-service predates the route" and falls back on).
 */
describe('DispatchMapController', () => {
  const service = { read: jest.fn() };
  const controller = new DispatchMapController(service as never);
  const user = createMockJwtUser({ id: 'u-1' });

  beforeEach(() => service.read.mockReset());

  it('is registered ahead of DealsController', () => {
    const controllers: unknown[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, DealsModule);
    expect(controllers.indexOf(DispatchMapController)).toBeGreaterThanOrEqual(0);
    expect(controllers.indexOf(DispatchMapController)).toBeLessThan(controllers.indexOf(DealsController));
    expect(Reflect.getMetadata(PATH_METADATA, DispatchMapController)).toBe('map');
  });

  it('is gated by deals.view, like the jobs list', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, controller.read)).toEqual({ resource: 'deals', action: 'view' });
  });

  it('answers the jobs, their count and who they name in the list envelope', async () => {
    const deals = [createMockDeal({ id: 'd1' }), createMockDeal({ id: 'd2' })];
    const included = { technicians: [], clients: [] };
    service.read.mockResolvedValue({ deals, included });

    await expect(controller.read({}, user, {} as never, 'Bearer t')).resolves.toEqual({
      success: true,
      data: deals,
      pagination: { count: 2 },
      included,
    });
  });

  it('hands the service the caller’s scope, whether they may see numbers, and their own token', async () => {
    service.read.mockResolvedValue({ deals: [], included: { technicians: [], clients: [] } });
    const perms = {
      permissions: { contacts: { view_numbers: true } },
      dataScope: { deals: 'assigned_only' },
    };

    await controller.read({ statuses: 'done', from: '2026-10-12' }, user, perms as never, 'Bearer t');
    await controller.read({}, user, { permissions: {}, dataScope: {} } as never, undefined);

    expect(service.read).toHaveBeenNthCalledWith(1, { statuses: 'done', from: '2026-10-12' }, user, 'assigned_only', {
      numbers: true,
      authorization: 'Bearer t',
    });
    expect(service.read).toHaveBeenNthCalledWith(2, {}, user, undefined, { numbers: false, authorization: undefined });
  });
});
