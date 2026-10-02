import { BadRequestException, HttpException } from '@nestjs/common';
import { DataScope } from '@bitcrm/types';
import { createMockDeal, createMockDealProduct, createMockJwtUser } from '../mocks';
import { buildLineItemsService } from './line-items.fixture';

/**
 * The owner's container rule (2026-10-02, as Workiz holds it): a technician
 * puts a stock-managed product on a job only out of HIS OWN container, and
 * only as many as it holds. Services, products whose stock is not counted and
 * item groups are exempt; the office (a wider `deals` scope) works as before.
 *
 * "Technician" is the codebase's own rule for job writes: the caller's
 * `deals` data scope is `assigned_only` (assertDealInScope).
 */
describe('DealsService — a technician adds stock only from his own container', () => {
  let ctx: Awaited<ReturnType<typeof buildLineItemsService>>;

  const tech = createMockJwtUser({ id: 'tech-1', roleId: 'role-technician' });
  const dispatcher = createMockJwtUser({ id: 'dispatcher-1', roleId: 'role-dispatcher' });
  const TECH = DataScope.ASSIGNED_ONLY;
  const OFFICE = DataScope.DEPARTMENT;
  const NOT_IN_VAN = "Kwikset Deadbolt isn't in your container";

  /** A stock-managed part (manageStock absent ⇒ counted, as inventory reads it). */
  const part = {
    id: 'product-1',
    name: 'Kwikset Deadbolt',
    sku: 'KW-DB-001',
    type: 'product',
    costCompany: 15,
    costTech: 20,
    priceClient: 45,
  };

  const fromHisVan = {
    fulfillment: 'sourced' as const,
    sourceTechId: 'tech-1',
    productId: 'product-1',
    name: 'Kwikset Deadbolt',
    sku: 'KW-DB-001',
    quantity: 2,
    priceClient: 45,
  };

  const refusal = async (promise: Promise<unknown>) => {
    const err = (await promise.then(() => undefined, (e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(BadRequestException);
    return err.message;
  };

  beforeEach(async () => {
    ctx = await buildLineItemsService();
    ctx.http.getProduct.mockResolvedValue(part);
    ctx.repo.findById.mockResolvedValue(createMockDeal({ assignedTechIds: ['tech-1', 'tech-2'] }));
  });

  /* ------------------------------------------------------------------ add */

  describe('adding a line', () => {
    it('takes it from his own van when it holds enough', async () => {
      await ctx.service.addProduct('deal-1', fromHisVan as any, tech, TECH);

      expect(ctx.http.deductStock).toHaveBeenCalledWith(
        expect.objectContaining({
          containerId: 'tech-1',
          items: [{ productId: 'product-1', productName: 'Kwikset Deadbolt', quantity: 2 }],
        }),
      );
      expect(ctx.products.addProduct.mock.calls[0][1]).toMatchObject({ fulfillment: 'sourced', sourceTechId: 'tech-1' });
    });

    it('sources from his own van when the phone names no technician', async () => {
      const { sourceTechId: _s, ...noSource } = fromHisVan;

      await ctx.service.addProduct('deal-1', noSource as any, tech, TECH);

      expect(ctx.http.deductStock).toHaveBeenCalledWith(expect.objectContaining({ containerId: 'tech-1' }));
      expect(ctx.products.addProduct.mock.calls[0][1]).toMatchObject({ sourceTechId: 'tech-1' });
    });

    it("refuses 'to order' — 400 naming the product, nothing deducted or written", async () => {
      expect(
        await refusal(
          ctx.service.addProduct('deal-1', { ...fromHisVan, fulfillment: 'to_order', sourceTechId: undefined } as any, tech, TECH),
        ),
      ).toBe(NOT_IN_VAN);
      expect(ctx.http.deductStock).not.toHaveBeenCalled();
      expect(ctx.products.addProduct).not.toHaveBeenCalled();
    });

    it("refuses another technician's van, even one on the same job", async () => {
      expect(
        await refusal(ctx.service.addProduct('deal-1', { ...fromHisVan, sourceTechId: 'tech-2' } as any, tech, TECH)),
      ).toBe(NOT_IN_VAN);
      expect(ctx.http.deductStock).not.toHaveBeenCalled();
      expect(ctx.products.addProduct).not.toHaveBeenCalled();
    });

    it('refuses more than his van holds — inventory says so, the product is named', async () => {
      ctx.http.deductStock.mockRejectedValue(new HttpException('Insufficient stock', 400));

      expect(await refusal(ctx.service.addProduct('deal-1', fromHisVan as any, tech, TECH))).toContain(
        '"Kwikset Deadbolt"',
      );
      expect(ctx.products.addProduct).not.toHaveBeenCalled();
    });

    it('lets him add a service line as before', async () => {
      ctx.http.getProduct.mockResolvedValue({ ...part, type: 'service' });

      await ctx.service.addProduct(
        'deal-1',
        { ...fromHisVan, fulfillment: 'service', sourceTechId: undefined } as any,
        tech,
        TECH,
      );

      expect(ctx.products.addProduct.mock.calls[0][1]).toMatchObject({ fulfillment: 'service' });
    });

    it('lets him order a product whose stock is not counted (manageStock false)', async () => {
      ctx.http.getProduct.mockResolvedValue({ ...part, manageStock: false });

      await ctx.service.addProduct(
        'deal-1',
        { ...fromHisVan, fulfillment: 'to_order', sourceTechId: undefined } as any,
        tech,
        TECH,
      );

      expect(ctx.products.addProduct.mock.calls[0][1]).toMatchObject({ fulfillment: 'to_order' });
    });

    it('leaves the office as it was: to-order lines and any assigned van', async () => {
      await ctx.service.addProduct(
        'deal-1',
        { ...fromHisVan, fulfillment: 'to_order', sourceTechId: undefined } as any,
        dispatcher,
        OFFICE,
      );
      await ctx.service.addProduct('deal-1', { ...fromHisVan, sourceTechId: 'tech-2' } as any, dispatcher, OFFICE);

      expect(ctx.products.addProduct).toHaveBeenCalledTimes(2);
      expect(ctx.http.deductStock).toHaveBeenCalledWith(expect.objectContaining({ containerId: 'tech-2' }));
    });
  });

  /* ----------------------------------------------------------------- edit */

  describe('editing a line (PUT …/products/:lineId)', () => {
    const hisLine = (over = {}) =>
      createMockDealProduct({ fulfillment: 'sourced', sourceTechId: 'tech-1', quantity: 2, ...over });

    it('raises the quantity out of his own van', async () => {
      ctx.products.findProduct.mockResolvedValue(hisLine());

      await ctx.service.replaceProduct('deal-1', 'line-1', { ...fromHisVan, quantity: 3 } as any, tech, TECH);

      expect(ctx.http.restoreStock).toHaveBeenCalledWith(expect.objectContaining({ containerId: 'tech-1' }));
      expect(ctx.http.deductStock).toHaveBeenCalledWith(expect.objectContaining({ containerId: 'tech-1' }));
      expect(ctx.products.addProduct.mock.calls[0][1]).toMatchObject({ quantity: 3 });
    });

    it('refuses a new quantity as to-order — before any stock moves', async () => {
      ctx.products.findProduct.mockResolvedValue(hisLine());

      expect(
        await refusal(
          ctx.service.replaceProduct(
            'deal-1', 'line-1',
            { ...fromHisVan, quantity: 3, fulfillment: 'to_order', sourceTechId: undefined } as any,
            tech, TECH,
          ),
        ),
      ).toBe(NOT_IN_VAN);
      expect(ctx.http.restoreStock).not.toHaveBeenCalled();
      expect(ctx.http.deductStock).not.toHaveBeenCalled();
      expect(ctx.products.addProduct).not.toHaveBeenCalled();
    });

    it("refuses a swap to another product out of someone else's van", async () => {
      ctx.products.findProduct.mockResolvedValue(hisLine({ productId: 'product-9' }));

      expect(
        await refusal(
          ctx.service.replaceProduct('deal-1', 'line-1', { ...fromHisVan, sourceTechId: 'tech-2' } as any, tech, TECH),
        ),
      ).toBe(NOT_IN_VAN);
      expect(ctx.http.restoreStock).not.toHaveBeenCalled();
    });

    it('refuses turning his van line into a to-order one — that would hand him the stock back', async () => {
      ctx.products.findProduct.mockResolvedValue(hisLine());

      expect(
        await refusal(
          ctx.service.replaceProduct(
            'deal-1', 'line-1',
            { ...fromHisVan, fulfillment: 'to_order', sourceTechId: undefined } as any,
            tech, TECH,
          ),
        ),
      ).toBe(NOT_IN_VAN);
      expect(ctx.http.restoreStock).not.toHaveBeenCalled();
    });

    it('lets him edit the text of a line the office ordered, as long as product and quantity stay', async () => {
      ctx.products.findProduct.mockResolvedValue(hisLine({ fulfillment: 'to_order', sourceTechId: undefined }));

      await ctx.service.replaceProduct(
        'deal-1', 'line-1',
        { ...fromHisVan, fulfillment: 'to_order', sourceTechId: undefined, description: 'Satin nickel' } as any,
        tech, TECH,
      );

      expect(ctx.products.addProduct.mock.calls[0][1]).toMatchObject({ fulfillment: 'to_order', description: 'Satin nickel' });
      expect(ctx.http.deductStock).not.toHaveBeenCalled();
    });

    it('lets him edit an imported Workiz line in place — it never moved stock, and still does not', async () => {
      ctx.products.findProduct.mockResolvedValue(
        hisLine({ fulfillment: 'imported', sourceTechId: undefined, priceClient: 45 }),
      );

      await ctx.service.replaceProduct(
        'deal-1', 'line-1',
        { ...fromHisVan, fulfillment: 'to_order', sourceTechId: undefined, description: 'From Workiz' } as any,
        tech, TECH,
      );

      expect(ctx.products.addProduct).toHaveBeenCalled();
    });

    it("keeps the line's own van when the phone names none on an in-place edit — nothing moves", async () => {
      // The office sourced it from tech-2; the technician only fixes the price.
      ctx.products.findProduct.mockResolvedValue(hisLine({ sourceTechId: 'tech-2', priceClient: 45 }));
      const { sourceTechId: _s, ...noSource } = fromHisVan;

      await ctx.service.replaceProduct('deal-1', 'line-1', { ...noSource, priceClient: 48 } as any, tech, TECH);

      expect(ctx.products.addProduct.mock.calls[0][1]).toMatchObject({ sourceTechId: 'tech-2', priceClient: 48 });
      expect(ctx.http.restoreStock).toHaveBeenCalledWith(expect.objectContaining({ containerId: 'tech-2' }));
      expect(ctx.http.deductStock).toHaveBeenCalledWith(expect.objectContaining({ containerId: 'tech-2' }));
    });

    it("refuses more of a line from someone else's van when the phone names none", async () => {
      ctx.products.findProduct.mockResolvedValue(hisLine({ sourceTechId: 'tech-2' }));
      const { sourceTechId: _s, ...noSource } = fromHisVan;

      expect(
        await refusal(ctx.service.replaceProduct('deal-1', 'line-1', { ...noSource, quantity: 3 } as any, tech, TECH)),
      ).toBe(NOT_IN_VAN);
      expect(ctx.http.restoreStock).not.toHaveBeenCalled();
    });

    it('leaves the office as it was', async () => {
      ctx.products.findProduct.mockResolvedValue(hisLine());

      await ctx.service.replaceProduct(
        'deal-1', 'line-1',
        { ...fromHisVan, quantity: 5, fulfillment: 'to_order', sourceTechId: undefined } as any,
        dispatcher, OFFICE,
      );

      expect(ctx.products.addProduct.mock.calls[0][1]).toMatchObject({ quantity: 5, fulfillment: 'to_order' });
    });
  });
});
