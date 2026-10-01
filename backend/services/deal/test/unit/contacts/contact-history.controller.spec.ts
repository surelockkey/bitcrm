import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PERMISSION_KEY } from '@bitcrm/shared';
import { DealsModule } from 'src/deals/deals.module';
import { DealsController } from 'src/deals/deals.controller';
import { ContactHistoryController } from 'src/contacts/contact-history.controller';

/**
 * `GET /deals/timeline/by-contact/:contactId?limit=&cursor=` — the client
 * card's History. Lives under the deals prefix ahead of DealsController, or
 * `GET /:id/timeline` would never see it anyway but `GET /:id` would swallow
 * `/timeline`.
 */
describe('ContactHistoryController', () => {
  const service = { list: jest.fn() };
  const controller = new ContactHistoryController(service as never);

  beforeEach(() => service.list.mockReset());

  it('is registered ahead of DealsController', () => {
    const controllers: unknown[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, DealsModule);
    expect(controllers.indexOf(ContactHistoryController)).toBeGreaterThanOrEqual(0);
    expect(controllers.indexOf(ContactHistoryController)).toBeLessThan(controllers.indexOf(DealsController));
    expect(Reflect.getMetadata(PATH_METADATA, ContactHistoryController)).toBe('timeline/by-contact');
  });

  it('is gated by deals.view, like the job’s own timeline', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, controller.list)).toEqual({ resource: 'deals', action: 'view' });
    expect(Reflect.getMetadata(PATH_METADATA, controller.list)).toBe(':contactId');
  });

  it('wraps the page in the envelope with the cursor and the count', async () => {
    const items = [{ id: 'e1' }, { id: 'e2' }];
    service.list.mockResolvedValue({ items, nextCursor: 'next' });

    await expect(controller.list('c1', '2', 'cur')).resolves.toEqual({
      success: true,
      data: items,
      pagination: { nextCursor: 'next', count: 2 },
    });
    expect(service.list).toHaveBeenCalledWith('c1', 2, 'cur');
  });

  it('limit defaults to 30 and is clamped to 1–100', async () => {
    service.list.mockResolvedValue({ items: [], nextCursor: undefined });
    await controller.list('c1', undefined, undefined);
    await controller.list('c1', '0', undefined);
    await controller.list('c1', '500', undefined);
    await controller.list('c1', 'abc', undefined);
    expect(service.list.mock.calls.map((c) => c[1])).toEqual([30, 1, 100, 30]);
  });
});
