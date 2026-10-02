import { IS_PUBLIC_KEY, PERMISSION_KEY } from '@bitcrm/shared';
import { ItemGroupsController } from 'src/item-groups/item-groups.controller';
import { InternalGuard } from 'src/common/guards/internal.guard';

describe('ItemGroupsController', () => {
  const service = { list: jest.fn(), findById: jest.fn() };
  const controller = new ItemGroupsController(service as any);

  beforeEach(() => jest.clearAllMocks());

  /** Groups sit in the price book: whoever may read the items may read the groups. */
  it('reads behind products.view, like the price book', () => {
    for (const route of [controller.list, controller.findById]) {
      expect(Reflect.getMetadata(PERMISSION_KEY, route)).toEqual({ resource: 'products', action: 'view' });
    }
  });

  it('serves deal-service through an internal route guarded by the service secret', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, controller.findByIdInternal)).toBe(true);
    expect(Reflect.getMetadata('__guards__', controller.findByIdInternal)).toEqual([InternalGuard]);
  });

  it('wraps each answer in { success, data }', async () => {
    service.list.mockResolvedValue([{ id: 'a' }]);
    service.findById.mockResolvedValue({ id: 'b' });

    await expect(controller.list()).resolves.toEqual({ success: true, data: [{ id: 'a' }] });
    await expect(controller.findById('b')).resolves.toEqual({ success: true, data: { id: 'b' } });
    await expect(controller.findByIdInternal('b')).resolves.toEqual({ success: true, data: { id: 'b' } });
    expect(service.findById).toHaveBeenCalledWith('b');
  });
});
