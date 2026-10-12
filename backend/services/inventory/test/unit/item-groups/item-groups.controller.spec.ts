import { IS_PUBLIC_KEY, PERMISSION_KEY } from '@bitcrm/shared';
import { ItemGroupsController } from 'src/item-groups/item-groups.controller';
import { InternalGuard } from 'src/common/guards/internal.guard';

const withMoney = { resolvedPermissions: { permissions: { financials: { view: true } } } };
const noMoney = { resolvedPermissions: { permissions: { financials: { view: false } } } };

const stored = {
  id: 'g',
  name: 'Storm door',
  members: [
    { productId: 'p1', name: 'Door', quantity: 1, priceClient: 288.9, cost: 160 },
    { productId: 'p2', name: 'Labor', quantity: 1, priceClient: 374, cost: 0 },
  ],
};

describe('ItemGroupsController', () => {
  const service = { list: jest.fn(), findById: jest.fn(), create: jest.fn(), update: jest.fn() };
  const controller = new ItemGroupsController(service as any);
  const user = { id: 'user-1' } as any;

  beforeEach(() => jest.clearAllMocks());

  /** Groups sit in the price book: whoever may read the items may read the groups. */
  it('reads behind products.view, like the price book', () => {
    for (const route of [controller.list, controller.findById]) {
      expect(Reflect.getMetadata(PERMISSION_KEY, route)).toEqual({ resource: 'products', action: 'view' });
    }
  });

  it("writes behind the price book's own create and edit (disable is an edit)", () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, controller.create)).toEqual({ resource: 'products', action: 'create' });
    expect(Reflect.getMetadata(PERMISSION_KEY, controller.update)).toEqual({ resource: 'products', action: 'edit' });
  });

  it('serves deal-service through an internal route guarded by the service secret', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, controller.findByIdInternal)).toBe(true);
    expect(Reflect.getMetadata('__guards__', controller.findByIdInternal)).toEqual([InternalGuard]);
  });

  it('wraps each answer in { success, data } and passes the status box through', async () => {
    service.list.mockResolvedValue([{ id: 'a', members: [] }]);
    service.findById.mockResolvedValue({ id: 'b', members: [] });

    await expect(controller.list({ status: 'active' }, withMoney)).resolves.toEqual({
      success: true,
      data: [{ id: 'a', members: [] }],
    });
    expect(service.list).toHaveBeenCalledWith('active');
    await expect(controller.findById('b', withMoney)).resolves.toEqual({ success: true, data: { id: 'b', members: [] } });
    await expect(controller.findByIdInternal('b')).resolves.toEqual({ success: true, data: { id: 'b', members: [] } });
    expect(service.findById).toHaveBeenCalledWith('b');
  });

  it("hides the members' cost from a caller without financials.view, everywhere but the internal route", async () => {
    service.list.mockResolvedValue([stored]);
    service.findById.mockResolvedValue(stored);
    service.create.mockResolvedValue(stored);
    service.update.mockResolvedValue(stored);

    const answers = [
      (await controller.list({}, noMoney)).data[0],
      (await controller.findById('g', noMoney)).data,
      (await controller.create({} as any, user, noMoney)).data,
      (await controller.update('g', {} as any, user, noMoney)).data,
    ];
    for (const group of answers) {
      for (const member of group.members) expect(member).not.toHaveProperty('cost');
    }
    expect((await controller.findById('g', withMoney)).data.members.map((m: { cost?: number }) => m.cost)).toEqual([160, 0]);
    expect((await controller.findByIdInternal('g')).data.members[0].cost).toBe(160);
  });

  it('tells the service whether the caller may set costs', async () => {
    service.create.mockResolvedValue(stored);
    service.update.mockResolvedValue(stored);

    await controller.create({ name: 'x' } as any, user, withMoney);
    await controller.update('g', { active: false } as any, user, noMoney);

    expect(service.create).toHaveBeenCalledWith({ name: 'x' }, user, { canSeeCost: true });
    expect(service.update).toHaveBeenCalledWith('g', { active: false }, user, { canSeeCost: false });
  });
});
