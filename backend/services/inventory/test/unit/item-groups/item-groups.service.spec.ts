import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { type ItemGroup } from '@bitcrm/types';
import { ItemGroupsService } from 'src/item-groups/item-groups.service';
import { createMockProduct } from '../mocks';

const group = (over: Partial<ItemGroup>): ItemGroup => ({
  id: 'g',
  name: 'Group',
  description: '',
  groupType: 'separate_items',
  active: true,
  members: [],
  total: 0,
  ...over,
});

const caller = { id: 'user-1' };
const MONEY = { canSeeCost: true };
const NO_MONEY = { canSeeCost: false };

describe('ItemGroupsService', () => {
  const repository = {
    listAll: jest.fn(),
    get: jest.fn(),
    getRow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const products = { findByIds: jest.fn() };
  const categories = { get: jest.fn() };
  const sns = { publish: jest.fn().mockResolvedValue(undefined) };
  const service = new ItemGroupsService(repository as any, products as any, categories as any, sns as any);

  const screen = createMockProduct({ id: 'prod-screen', name: 'Screen', priceClient: 300, costCompany: 120, taxable: true });
  const labor = createMockProduct({ id: 'prod-labor', name: 'Labor', priceClient: 125, costCompany: 0, taxable: false });

  beforeEach(() => {
    jest.clearAllMocks();
    repository.listAll.mockResolvedValue([]);
    products.findByIds.mockResolvedValue([screen, labor]);
    repository.create.mockResolvedValue(undefined);
    repository.get.mockImplementation(async (id: string) => group({ id }));
  });

  describe('list', () => {
    beforeEach(() => {
      repository.listAll.mockResolvedValue([
        group({ id: '1', name: 'Sliding 60 x 80 estimate' }),
        group({ id: '2', name: '7QUO80 ESTIMATE', active: false }),
        group({ id: '3', name: 'commercial door' }),
      ]);
    });

    it('lists every group by name, case-insensitively, as Workiz does', async () => {
      const list = await service.list();

      expect(list.map((g) => g.name)).toEqual(['7QUO80 ESTIMATE', 'commercial door', 'Sliding 60 x 80 estimate']);
    });

    it("narrows to Workiz's status box: Active or Disabled", async () => {
      expect((await service.list('active')).map((g) => g.id)).toEqual(['3', '1']);
      expect((await service.list('disabled')).map((g) => g.id)).toEqual(['2']);
      expect((await service.list('all')).map((g) => g.id)).toEqual(['2', '3', '1']);
    });
  });

  it('finds one group by id', async () => {
    repository.get.mockResolvedValue(group({ id: 'g-1' }));

    await expect(service.findById('g-1')).resolves.toMatchObject({ id: 'g-1' });
    expect(repository.get).toHaveBeenCalledWith('g-1');
  });

  it('answers 404 for a group that is not there', async () => {
    repository.get.mockResolvedValue(null);

    await expect(service.findById('nope')).rejects.toThrow(new NotFoundException('Item group nope not found'));
  });

  describe('create', () => {
    const dto = {
      name: '  Storm Door 36" x 80"  ',
      description: 'Door and labor',
      members: [
        { productId: 'prod-screen', quantity: 1, priceClient: 288.9, cost: 160 },
        { productId: 'prod-labor', quantity: 1.5, priceClient: 374 },
      ],
    };

    it('stores an Individual items group: the members as given, names and taxable from the price book', async () => {
      await service.create(dto as any, caller, MONEY);

      const stored = repository.create.mock.calls[0][0];
      expect(stored).toMatchObject({
        name: 'Storm Door 36" x 80"',
        description: 'Door and labor',
        groupType: 'separate_items',
        active: true,
        createdBy: caller.id,
      });
      expect(stored.id).toEqual(expect.any(String));
      expect(stored.createdAt).toBe(stored.updatedAt);
      expect(stored).not.toHaveProperty('categoryId');
      expect(stored.members).toEqual([
        { productId: 'prod-screen', name: 'Screen', quantity: 1, priceClient: 288.9, cost: 160, taxable: true, description: '', customAttributes: {} },
        // No cost sent: the price book's company cost, as Workiz's import does.
        { productId: 'prod-labor', name: 'Labor', quantity: 1.5, priceClient: 374, cost: 0, taxable: false, description: '', customAttributes: {} },
      ]);
    });

    it('answers the stored group, read back', async () => {
      repository.get.mockResolvedValue(group({ id: 'read-back', name: 'Storm Door 36" x 80"' }));

      await expect(service.create(dto as any, caller, MONEY)).resolves.toMatchObject({ id: 'read-back' });
      expect(repository.get).toHaveBeenCalledWith(repository.create.mock.calls[0][0].id);
    });

    it("takes the member's own name, description, taxable flag and custom field values when sent", async () => {
      await service.create(
        {
          name: 'Commercial door',
          members: [
            {
              productId: 'prod-screen',
              name: ' Commercial Steel Door Assembly ',
              description: '3070 18ga',
              taxable: false,
              quantity: 1,
              priceClient: 1328.5,
              customAttributes: { 'In Store Location': '8-B-8', Blank: '  ' },
            },
          ],
        } as any,
        caller,
        MONEY,
      );

      expect(repository.create.mock.calls[0][0].members[0]).toMatchObject({
        name: 'Commercial Steel Door Assembly',
        description: '3070 18ga',
        taxable: false,
        customAttributes: { 'In Store Location': '8-B-8' },
      });
    });

    it('ignores a cost sent by someone who may not see money: the price book cost is stored', async () => {
      await service.create(dto as any, caller, NO_MONEY);

      expect(repository.create.mock.calls[0][0].members.map((m: { cost: number }) => m.cost)).toEqual([120, 0]);
    });

    it('files the group under a category that exists, and refuses one that does not', async () => {
      categories.get.mockResolvedValueOnce({ id: 'cat-1', name: 'Doors' });
      await service.create({ ...dto, categoryId: 'cat-1' } as any, caller, MONEY);
      expect(repository.create.mock.calls[0][0].categoryId).toBe('cat-1');

      categories.get.mockResolvedValueOnce(null);
      await expect(service.create({ ...dto, categoryId: 'gone' } as any, caller, MONEY)).rejects.toThrow(
        new BadRequestException('Category gone not found'),
      );
    });

    it('treats an empty category as none', async () => {
      await service.create({ ...dto, categoryId: '' } as any, caller, MONEY);

      expect(categories.get).not.toHaveBeenCalled();
      expect(repository.create.mock.calls[0][0]).not.toHaveProperty('categoryId');
    });

    it('refuses an item the price book does not hold, naming it', async () => {
      products.findByIds.mockResolvedValue([screen]);

      await expect(service.create(dto as any, caller, MONEY)).rejects.toThrow(
        new BadRequestException('Item prod-labor is not in the price book'),
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('refuses a group without items', async () => {
      await expect(service.create({ name: 'Empty', members: [] } as any, caller, MONEY)).rejects.toThrow(
        new BadRequestException('Add at least one item'),
      );
    });

    it("refuses a name another group has (any case) with Workiz's words", async () => {
      repository.listAll.mockResolvedValue([group({ id: 'other', name: 'storm door 36" x 80"' })]);

      await expect(service.create(dto as any, caller, MONEY)).rejects.toThrow(
        new ConflictException('Name is in use, please pick a different one'),
      );
    });

    it('can create a group switched off, and publishes item-group.created', async () => {
      await service.create({ ...dto, active: false } as any, caller, MONEY);

      const stored = repository.create.mock.calls[0][0];
      expect(stored.active).toBe(false);
      expect(sns.publish).toHaveBeenCalledWith('inventory-events', 'item-group.created', {
        itemGroupId: stored.id,
        name: stored.name,
      });
    });
  });

  describe('update', () => {
    /** The row the import wrote: members carry Workiz's extras. */
    const row = {
      id: 'g-1',
      name: 'Commercial door',
      members: [
        {
          productId: 'prod-screen',
          name: 'Commercial Steel Door Assembly',
          quantity: 1,
          priceClient: 1328.5,
          taxable: true,
          description: 'Steel',
          customAttributes: { 'In Store Location': '1-A' },
          cost: 740,
          workizItemId: '10897',
          groupMemberId: '1600001',
          nonDiscountable: false,
          manageStock: false,
        },
        { productId: 'prod-labor', name: 'Professional Labor (Per Hour)', quantity: 8, priceClient: 145, taxable: true, cost: 0 },
      ],
    };

    beforeEach(() => {
      repository.getRow.mockResolvedValue(row);
      repository.update.mockImplementation(async (id: string) => group({ id }));
      repository.listAll.mockResolvedValue([group({ id: 'g-1', name: 'Commercial door' })]);
    });

    it('404s for a group that is not there', async () => {
      repository.getRow.mockResolvedValue(null);

      await expect(service.update('nope', { active: false } as any, caller, MONEY)).rejects.toThrow(
        new NotFoundException('Item group nope not found'),
      );
    });

    it('switches a group off or on without touching anything else', async () => {
      repository.update.mockResolvedValueOnce(group({ id: 'g-1', name: 'Commercial door', active: false }));

      await expect(service.update('g-1', { active: false } as any, caller, MONEY)).resolves.toMatchObject({ active: false });

      expect(repository.update).toHaveBeenCalledWith(
        'g-1',
        { active: false },
        { updatedAt: expect.any(String), updatedBy: caller.id },
      );
      expect(sns.publish).toHaveBeenCalledWith('inventory-events', 'item-group.updated', {
        itemGroupId: 'g-1',
        name: 'Commercial door',
        active: false,
      });
    });

    it("keeps each member's name, description, values, cost and Workiz extras when the members come back unchanged", async () => {
      await service.update(
        'g-1',
        {
          members: [
            { productId: 'prod-screen', quantity: 2, priceClient: 1300 },
            { productId: 'prod-labor', quantity: 8, priceClient: 145 },
          ],
        } as any,
        caller,
        NO_MONEY,
      );

      const members = repository.update.mock.calls[0][1].members;
      expect(members[0]).toEqual({
        productId: 'prod-screen',
        name: 'Commercial Steel Door Assembly',
        quantity: 2,
        priceClient: 1300,
        taxable: true,
        description: 'Steel',
        customAttributes: { 'In Store Location': '1-A' },
        cost: 740,
        workizItemId: '10897',
        groupMemberId: '1600001',
        nonDiscountable: false,
        manageStock: false,
      });
      expect(members[1]).toMatchObject({ name: 'Professional Labor (Per Hour)', cost: 0, taxable: true });
    });

    it('lets a caller who may see money change a member cost', async () => {
      await service.update(
        'g-1',
        { members: [{ productId: 'prod-screen', quantity: 1, priceClient: 1328.5, cost: 800 }] } as any,
        caller,
        MONEY,
      );

      expect(repository.update.mock.calls[0][1].members).toEqual([
        expect.objectContaining({ productId: 'prod-screen', cost: 800, workizItemId: '10897' }),
      ]);
    });

    it('matches repeated products in order, so a generic item used twice keeps both lines', async () => {
      repository.getRow.mockResolvedValue({
        ...row,
        members: [
          { productId: 'prod-screen', name: 'Service Call Fee', quantity: 1, priceClient: 45, cost: 0 },
          { productId: 'prod-screen', name: 'Rear Door', quantity: 1, priceClient: 1700, cost: 1000 },
        ],
      });

      await service.update(
        'g-1',
        {
          members: [
            { productId: 'prod-screen', quantity: 1, priceClient: 45 },
            { productId: 'prod-screen', quantity: 1, priceClient: 1700 },
          ],
        } as any,
        caller,
        NO_MONEY,
      );

      expect(repository.update.mock.calls[0][1].members.map((m: { name: string; cost: number }) => [m.name, m.cost])).toEqual([
        ['Service Call Fee', 0],
        ['Rear Door', 1000],
      ]);
    });

    it('renames (trimmed), checking the name against the other groups only', async () => {
      await service.update('g-1', { name: ' Commercial door ' } as any, caller, MONEY);
      expect(repository.update.mock.calls[0][1]).toEqual({ name: 'Commercial door' });

      repository.listAll.mockResolvedValue([group({ id: 'g-1', name: 'Commercial door' }), group({ id: 'g-2', name: 'Metal Door' })]);
      await expect(service.update('g-1', { name: 'metal door' } as any, caller, MONEY)).rejects.toThrow(ConflictException);
    });

    it('clears the category with an empty value and checks a new one', async () => {
      await service.update('g-1', { categoryId: '' } as any, caller, MONEY);
      expect(repository.update.mock.calls[0][1]).toEqual({ categoryId: null });

      categories.get.mockResolvedValueOnce(null);
      await expect(service.update('g-1', { categoryId: 'gone' } as any, caller, MONEY)).rejects.toThrow(BadRequestException);
    });

    it('refuses to empty a group', async () => {
      await expect(service.update('g-1', { members: [] } as any, caller, MONEY)).rejects.toThrow(
        new BadRequestException('Add at least one item'),
      );
    });
  });
});
