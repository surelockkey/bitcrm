import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { DataScope, TimelineEventType, type ItemGroup } from '@bitcrm/types';
import { createMockDeal, createMockDealProduct, createMockJwtUser } from '../mocks';
import { buildLineItemsService } from './line-items.fixture';

/**
 * Workiz "Add group": every item of an item group lands on the job as its own
 * line, in one call — the group's quantities, prices, taxable flags,
 * descriptions and custom field values; the costs from the price book. A group
 * is exempt from the technician's container rule: a stock-managed member comes
 * out of his van when it holds enough and is added to order otherwise.
 */
describe('DealsService — adding an item group to a job', () => {
  let ctx: Awaited<ReturnType<typeof buildLineItemsService>>;

  const tech = createMockJwtUser({ id: 'tech-1', email: 'tech@test.com', roleId: 'role-technician' });
  const dispatcher = createMockJwtUser({ id: 'dispatcher-1', roleId: 'role-dispatcher' });
  const TECH = DataScope.ASSIGNED_ONLY;
  const OFFICE = DataScope.DEPARTMENT;

  const catalog: Record<string, Record<string, unknown>> = {
    door: {
      id: 'door', name: '36" Black Fiberglass Prehung Door', sku: 'DOOR-36', type: 'product',
      costCompany: 600, costTech: 650, priceClient: 1200,
      customAttributes: { 'In Store Location': 'Bay 2', Link_UHS: 'https://uhs.example/door' },
    },
    deadbolt: {
      id: 'deadbolt', name: 'Kwikset Deadbolt', sku: 'KW-DB-001', type: 'product',
      costCompany: 15, costTech: 20, priceClient: 45,
    },
    screen: {
      id: 'screen', name: 'Aluminum Screen', sku: 'WZ-15195', type: 'product', manageStock: false,
      costCompany: 0, costTech: 0, priceClient: 300,
    },
    labor: {
      id: 'labor', name: 'Door Removal & Installation Labor', sku: 'WZ-2489', type: 'service',
      costCompany: 0, costTech: 0, priceClient: 125,
    },
  };

  const group: ItemGroup = {
    id: 'group-1',
    name: '36 x 80 Fiberglass Front Door',
    description: '',
    total: 3060,
    members: [
      {
        productId: 'door', name: '36" x 80" Black Fiberglass Prehung Front Door', quantity: 1,
        priceClient: 2040, taxable: true, description: 'Hardware included',
        customAttributes: { 'In Store Location': 'Warehouse A' },
      },
      {
        productId: 'deadbolt', name: 'Deadbolt Installation (Lock Included)', quantity: 2,
        priceClient: 185, taxable: true, description: '', customAttributes: {},
      },
      {
        productId: 'screen', name: 'Screen', quantity: 1, priceClient: 300, taxable: false,
        description: '', customAttributes: {},
      },
      {
        productId: 'labor', name: 'Door Removal & Installation Labor', quantity: 3, priceClient: 125,
        taxable: false, description: 'Per hour', customAttributes: {},
      },
    ],
  };

  const lines = () => ctx.products.addProduct.mock.calls.map(([, line]: [string, any]) => line);
  const byProduct = (productId: string) => lines().find((l: any) => l.productId === productId);

  beforeEach(async () => {
    ctx = await buildLineItemsService();
    ctx.http.getItemGroup.mockResolvedValue(group);
    ctx.http.getProduct.mockImplementation(async (id: string) => catalog[id] ?? null);
    ctx.repo.findById.mockResolvedValue(createMockDeal({ assignedTechIds: ['tech-1', 'tech-2'] }));
  });

  it('adds every member as its own line, from the group, with the price-book costs', async () => {
    const added = await ctx.service.addItemGroup('deal-1', 'group-1', {}, tech, TECH);

    expect(ctx.http.getItemGroup).toHaveBeenCalledWith('group-1');
    expect(lines()).toHaveLength(4);
    expect(byProduct('door')).toMatchObject({
      name: '36" x 80" Black Fiberglass Prehung Front Door',
      sku: 'DOOR-36',
      quantity: 1,
      priceClient: 2040,
      costCompany: 600,
      costForTech: 650,
      taxable: true,
      description: 'Hardware included',
      priceSource: 'group',
      itemGroupId: 'group-1',
      addedBy: 'tech-1',
    });
    expect(byProduct('labor')).toMatchObject({ quantity: 3, priceClient: 125, taxable: false, description: 'Per hour' });
    expect(byProduct('deadbolt')).not.toHaveProperty('description');
    // Every line has its own id, and the call answers the lines it wrote.
    expect(new Set(lines().map((l: any) => l.lineId)).size).toBe(4);
    expect(added.map((l: any) => l.lineId)).toEqual(lines().map((l: any) => l.lineId));
  });

  it("takes the group's custom field values over the product's", async () => {
    await ctx.service.addItemGroup('deal-1', 'group-1', {}, tech, TECH);

    expect(byProduct('door').customAttributes).toEqual({
      'In Store Location': 'Warehouse A',
      Link_UHS: 'https://uhs.example/door',
    });
    expect(byProduct('deadbolt')).not.toHaveProperty('customAttributes');
  });

  it("does not judge the group's prices by the ±15% band — they are the group's", async () => {
    // $2,040 for a $1,200 door, $185 for a $45 deadbolt.
    await ctx.service.addItemGroup('deal-1', 'group-1', {}, tech, TECH);

    expect(byProduct('door').priceClient).toBe(2040);
    expect(byProduct('deadbolt').priceClient).toBe(185);
  });

  describe("a technician's van", () => {
    it('gives the stock-managed members it holds — sourced from him', async () => {
      await ctx.service.addItemGroup('deal-1', 'group-1', {}, tech, TECH);

      expect(ctx.http.deductStock).toHaveBeenCalledWith(
        expect.objectContaining({
          containerId: 'tech-1',
          items: [{ productId: 'door', productName: '36" x 80" Black Fiberglass Prehung Front Door', quantity: 1 }],
          dealId: 'deal-1',
          performedBy: 'tech-1',
        }),
      );
      expect(byProduct('door')).toMatchObject({ fulfillment: 'sourced', sourceTechId: 'tech-1' });
      expect(byProduct('deadbolt')).toMatchObject({ fulfillment: 'sourced', sourceTechId: 'tech-1' });
    });

    it('adds to order what it does not hold — the group is exempt from the container rule', async () => {
      ctx.http.deductStock.mockImplementation(async (dto: any) => {
        if (dto.items[0].productId === 'deadbolt') throw new HttpException('Insufficient stock', 400);
      });

      await ctx.service.addItemGroup('deal-1', 'group-1', {}, tech, TECH);

      expect(byProduct('door')).toMatchObject({ fulfillment: 'sourced', sourceTechId: 'tech-1' });
      expect(byProduct('deadbolt')).toMatchObject({ fulfillment: 'to_order' });
      expect(byProduct('deadbolt')).not.toHaveProperty('sourceTechId');
    });

    it('adds every stock-managed member to order when he has no container at all', async () => {
      ctx.http.deductStock.mockRejectedValue(new HttpException('Container "tech-1" not found', 404));

      await ctx.service.addItemGroup('deal-1', 'group-1', {}, tech, TECH);

      expect(byProduct('door').fulfillment).toBe('to_order');
      expect(byProduct('deadbolt').fulfillment).toBe('to_order');
    });

    it('moves no stock for a service or a product whose stock is not counted', async () => {
      await ctx.service.addItemGroup('deal-1', 'group-1', {}, tech, TECH);

      const deducted = ctx.http.deductStock.mock.calls.map(([dto]: [any]) => dto.items[0].productId);
      expect(deducted).toEqual(['door', 'deadbolt']);
      expect(byProduct('labor')).toMatchObject({ fulfillment: 'service' });
      expect(byProduct('labor')).not.toHaveProperty('sourceTechId');
      expect(byProduct('screen')).toMatchObject({ fulfillment: 'sourced', sourceTechId: 'tech-1' });
    });

    it('is always his own, whatever technician the request names', async () => {
      await ctx.service.addItemGroup('deal-1', 'group-1', { sourceTechId: 'tech-2' }, tech, TECH);

      for (const [dto] of ctx.http.deductStock.mock.calls) expect(dto.containerId).toBe('tech-1');
    });

    it('gets back what it gave when inventory fails mid-way — nothing is written', async () => {
      ctx.http.deductStock
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new BadGatewayException('Stock deduction failed: ECONNRESET'));

      await expect(ctx.service.addItemGroup('deal-1', 'group-1', {}, tech, TECH)).rejects.toBeInstanceOf(
        BadGatewayException,
      );

      expect(ctx.http.restoreStock).toHaveBeenCalledTimes(1);
      expect(ctx.http.restoreStock).toHaveBeenCalledWith(
        expect.objectContaining({ containerId: 'tech-1', items: [expect.objectContaining({ productId: 'door', quantity: 1 })] }),
      );
      expect(ctx.products.addProduct).not.toHaveBeenCalled();
    });
  });

  describe('the office', () => {
    it("adds the products to order when it names no van and is not on the job", async () => {
      await ctx.service.addItemGroup('deal-1', 'group-1', {}, dispatcher, OFFICE);

      expect(ctx.http.deductStock).not.toHaveBeenCalled();
      expect(byProduct('door').fulfillment).toBe('to_order');
      expect(byProduct('screen').fulfillment).toBe('to_order');
      expect(byProduct('labor').fulfillment).toBe('service');
    });

    it('takes from the van of the assigned technician it names', async () => {
      await ctx.service.addItemGroup('deal-1', 'group-1', { sourceTechId: 'tech-2' }, dispatcher, OFFICE);

      expect(ctx.http.deductStock).toHaveBeenCalledWith(expect.objectContaining({ containerId: 'tech-2' }));
      expect(byProduct('door')).toMatchObject({ fulfillment: 'sourced', sourceTechId: 'tech-2' });
    });

    it('refuses a van of a technician who is not on the job', async () => {
      await expect(
        ctx.service.addItemGroup('deal-1', 'group-1', { sourceTechId: 'tech-9' }, dispatcher, OFFICE),
      ).rejects.toThrow(new BadRequestException('The chosen technician is not assigned to this deal'));
      expect(ctx.http.deductStock).not.toHaveBeenCalled();
    });
  });

  describe('refusals, before any stock moves', () => {
    it("403 on a job the technician is not on", async () => {
      ctx.repo.findById.mockResolvedValue(createMockDeal({ assignedTechIds: ['tech-2'] }));

      await expect(ctx.service.addItemGroup('deal-1', 'group-1', {}, tech, TECH)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(ctx.http.getItemGroup).not.toHaveBeenCalled();
      expect(ctx.http.deductStock).not.toHaveBeenCalled();
    });

    it('404 for a group inventory does not have', async () => {
      ctx.http.getItemGroup.mockResolvedValue(null);

      await expect(ctx.service.addItemGroup('deal-1', 'nope', {}, tech, TECH)).rejects.toThrow(
        new NotFoundException('Item group nope not found'),
      );
    });

    it('400 for a group with no items', async () => {
      ctx.http.getItemGroup.mockResolvedValue({ ...group, members: [] });

      await expect(ctx.service.addItemGroup('deal-1', 'group-1', {}, tech, TECH)).rejects.toThrow(
        new BadRequestException(`Item group "36 x 80 Fiberglass Front Door" has no items`),
      );
    });

    it('400 naming a member whose product is gone from the price book', async () => {
      ctx.http.getProduct.mockImplementation(async (id: string) => (id === 'screen' ? null : catalog[id]));

      await expect(ctx.service.addItemGroup('deal-1', 'group-1', {}, tech, TECH)).rejects.toThrow(
        new BadRequestException('Product "Screen" was not found in inventory'),
      );
      expect(ctx.http.deductStock).not.toHaveBeenCalled();
      expect(ctx.products.addProduct).not.toHaveBeenCalled();
    });
  });

  it('logs one timeline entry, refreshes the totals once and tells billing once', async () => {
    await ctx.service.addItemGroup('deal-1', 'group-1', {}, tech, TECH);

    const entries = ctx.timeline.addEntry.mock.calls.map(([e]: [any]) => e);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      eventType: TimelineEventType.PRODUCT_ADDED,
      actorId: 'tech-1',
      details: {
        productName: '36 x 80 Fiberglass Front Door',
        itemGroupId: 'group-1',
        itemGroupName: '36 x 80 Fiberglass Front Door',
      },
    });
    expect(entries[0].details.items).toHaveLength(4);
    expect(entries[0].details.items[0]).toEqual({
      productId: 'door',
      productName: '36" x 80" Black Fiberglass Prehung Front Door',
      quantity: 1,
      fulfillment: 'sourced',
    });
    const published = ctx.sns.publish.mock.calls.filter(([, type]: [string, string]) => type === 'deal.product_added');
    expect(published).toHaveLength(1);
    expect(published[0][2]).toMatchObject({ dealId: 'deal-1', itemGroupId: 'group-1' });
    // refreshTotals reads the job's lines once, after all of them are written.
    expect(ctx.products.findByDeal).toHaveBeenCalledTimes(1);
    expect(ctx.repo.update).toHaveBeenCalledTimes(1);
  });

  describe('editing a group line later (PUT …/products/:lineId)', () => {
    const groupLine = (over = {}) =>
      createMockDealProduct({
        productId: 'deadbolt',
        fulfillment: 'to_order',
        sourceTechId: undefined,
        quantity: 2,
        priceClient: 185,
        priceSource: 'group',
        itemGroupId: 'group-1',
        ...over,
      });
    const edit = {
      fulfillment: 'to_order' as const,
      productId: 'deadbolt',
      name: 'Deadbolt Installation (Lock Included)',
      sku: 'KW-DB-001',
      quantity: 2,
      priceClient: 185,
    };

    it("keeps the group's price, out of the band, while the line keeps it", async () => {
      ctx.products.findProduct.mockResolvedValue(groupLine());

      await ctx.service.replaceProduct('deal-1', 'line-1', { ...edit, description: 'Satin nickel' } as any, dispatcher, OFFICE);

      expect(lines()[0]).toMatchObject({ priceClient: 185, priceSource: 'group', itemGroupId: 'group-1' });
    });

    it('judges a new price typed on it, and the line then stops being a group price', async () => {
      ctx.products.findProduct.mockResolvedValue(groupLine());

      await expect(
        ctx.service.replaceProduct('deal-1', 'line-1', { ...edit, priceClient: 184 } as any, dispatcher, OFFICE),
      ).rejects.toThrow(BadRequestException);

      await ctx.service.replaceProduct('deal-1', 'line-1', { ...edit, priceClient: 50 } as any, dispatcher, OFFICE);
      expect(lines()[0]).not.toHaveProperty('priceSource');
      expect(lines()[0]).toMatchObject({ itemGroupId: 'group-1' });
    });
  });
});
