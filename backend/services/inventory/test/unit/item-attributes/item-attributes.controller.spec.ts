import { PERMISSION_KEY } from '@bitcrm/shared';
import { ItemAttributesController } from 'src/item-attributes/item-attributes.controller';
import { createMockJwtUser } from '../mocks';

describe('ItemAttributesController', () => {
  const service = {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const controller = new ItemAttributesController(service as any);
  const user = createMockJwtUser();

  beforeEach(() => jest.clearAllMocks());

  /** Custom fields are edited from the item popup, so the item guards apply. */
  it('reads behind products.view, changes behind products.edit', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, controller.list)).toEqual({ resource: 'products', action: 'view' });
    for (const route of [controller.create, controller.update, controller.remove]) {
      expect(Reflect.getMetadata(PERMISSION_KEY, route)).toEqual({ resource: 'products', action: 'edit' });
    }
  });

  it('wraps each answer in { success, data }', async () => {
    service.list.mockResolvedValue([{ id: 'a' }]);
    service.create.mockResolvedValue({ id: 'b' });
    service.update.mockResolvedValue({ id: 'a', productsUpdated: 2, productsSkipped: 0 });
    service.remove.mockResolvedValue({ productsUpdated: 5, productsSkipped: 0 });

    await expect(controller.list()).resolves.toEqual({ success: true, data: [{ id: 'a' }] });
    await expect(controller.create({ name: 'Bin' } as any, user)).resolves.toEqual({
      success: true,
      data: { id: 'b' },
    });
    await expect(controller.update('a', { name: 'B' } as any, user)).resolves.toEqual({
      success: true,
      data: { id: 'a', productsUpdated: 2, productsSkipped: 0 },
    });
    await expect(controller.remove('a', user)).resolves.toEqual({
      success: true,
      data: { id: 'a', deleted: true, productsUpdated: 5, productsSkipped: 0 },
    });
    expect(service.update).toHaveBeenCalledWith('a', { name: 'B' }, user);
  });
});
