import { TimelineEventType } from '@bitcrm/types';
import { createMockDeal, createMockDealProduct, createMockJwtUser } from '../mocks';
import { buildLineItemsService } from './line-items.fixture';

/**
 * Workiz "Add job item": a Cost box the office fills in (the price book's
 * number prefilled) and a "Sold by" pick. The cost is the line's own from
 * then on; Sold by is a user id the line remembers.
 */
describe('DealsService — the line’s own cost and Sold by', () => {
  let ctx: Awaited<ReturnType<typeof buildLineItemsService>>;

  const office = createMockJwtUser({ id: 'admin-1', roleId: 'role-admin' });
  const tech = createMockJwtUser({ id: 'tech-1', roleId: 'role-technician' });

  const catalog = { id: 'product-1', name: 'Kwikset Deadbolt', sku: 'KW-DB-001', type: 'product', costCompany: 15, costTech: 20, priceClient: 45 };
  const line0 = { fulfillment: 'to_order' as const, productId: 'product-1', name: 'Kwikset Deadbolt', sku: 'KW-DB-001', quantity: 1, priceClient: 45 };
  const line = line0;

  beforeEach(async () => {
    ctx = await buildLineItemsService();
    ctx.http.getProduct.mockResolvedValue(catalog);
    ctx.repo.findById.mockResolvedValue(createMockDeal({ assignedTechIds: ['tech-1'] }));
  });

  const written = () => ctx.products.addProduct.mock.calls[0][1];

  describe('cost', () => {
    it('the office (financials.view) sets the cost of a new line', async () => {
      await ctx.service.addProduct('deal-1', { ...line, costCompany: 12.5 } as any, office, undefined, { mayCost: true });
      expect(written()).toMatchObject({ costCompany: 12.5, costForTech: 20 });
    });

    it('a caller without financials.view gets the price book cost whatever was sent', async () => {
      await ctx.service.addProduct('deal-1', { ...line, costCompany: 1 } as any, tech, undefined, { mayCost: false });
      expect(written()).toMatchObject({ costCompany: 15 });
    });

    it('an edit that sends no cost keeps the line’s own, and logs no cost change', async () => {
      ctx.products.findProduct.mockResolvedValue(createMockDealProduct({ fulfillment: 'to_order', costCompany: 10, costForTech: 12 }));

      await ctx.service.replaceProduct('deal-1', 'line-1', { ...line, quantity: 2 } as any, tech, undefined, { mayCost: false });

      expect(written()).toMatchObject({ quantity: 2, costCompany: 10, costForTech: 12 });
      const entry = ctx.timeline.addEntry.mock.calls.map(([e]: [any]) => e).find((e: any) => e.eventType === TimelineEventType.PRODUCT_UPDATED);
      expect(entry.details.changes).toEqual({ quantity: { from: 1, to: 2 } });
    });

    it('the office retypes the cost on an edit, and the change is logged', async () => {
      ctx.products.findProduct.mockResolvedValue(createMockDealProduct({ fulfillment: 'to_order', costCompany: 10, costForTech: 12 }));

      await ctx.service.replaceProduct('deal-1', 'line-1', { ...line, costCompany: 7 } as any, office, undefined, { mayCost: true });

      expect(written()).toMatchObject({ costCompany: 7 });
      const entry = ctx.timeline.addEntry.mock.calls.map(([e]: [any]) => e).find((e: any) => e.eventType === TimelineEventType.PRODUCT_UPDATED);
      expect(entry.details.changes).toEqual({ costCompany: { from: 10, to: 7 } });
    });
  });

  describe('the write answers with the line (the page draws it without a reread)', () => {
    it('addProduct returns the line it wrote, under a minted id', async () => {
      const line = await ctx.service.addProduct('deal-1', { ...line0, soldBy: 'user-9' } as any, office, undefined, { mayCost: true });
      expect(line.lineId).toEqual(expect.any(String));
      expect(line).toMatchObject({ productId: 'product-1', quantity: 1, priceClient: 45, costCompany: 15, soldBy: 'user-9', fulfillment: 'to_order' });
      expect(written()).toMatchObject({ lineId: line.lineId });
    });

    it('replaceProduct returns the rewritten line under the same id', async () => {
      ctx.products.findProduct.mockResolvedValue(createMockDealProduct({ lineId: 'line-1', fulfillment: 'to_order', costCompany: 10 }));
      const line = await ctx.service.replaceProduct('deal-1', 'line-1', { ...line0, quantity: 3 } as any, office);
      expect(line).toMatchObject({ lineId: 'line-1', quantity: 3, costCompany: 10 });
    });
  });

  describe('Sold by', () => {
    it('is stored on a new line when sent, absent otherwise', async () => {
      await ctx.service.addProduct('deal-1', { ...line, soldBy: 'user-9' } as any, office);
      expect(written()).toMatchObject({ soldBy: 'user-9' });

      ctx.products.addProduct.mockClear();
      await ctx.service.addProduct('deal-1', line as any, office);
      expect(written()).not.toHaveProperty('soldBy');
    });

    it('an edit keeps it when not sent, replaces it when sent, clears it on an empty string', async () => {
      ctx.products.findProduct.mockResolvedValue(createMockDealProduct({ fulfillment: 'to_order', soldBy: 'user-9' }));

      await ctx.service.replaceProduct('deal-1', 'line-1', line as any, office);
      expect(written()).toMatchObject({ soldBy: 'user-9' });

      ctx.products.addProduct.mockClear();
      await ctx.service.replaceProduct('deal-1', 'line-1', { ...line, soldBy: 'user-2' } as any, office);
      expect(written()).toMatchObject({ soldBy: 'user-2' });

      ctx.products.addProduct.mockClear();
      await ctx.service.replaceProduct('deal-1', 'line-1', { ...line, soldBy: '' } as any, office);
      expect(written()).not.toHaveProperty('soldBy');
    });
  });

  describe('the job’s Company Cost follows its lines (Workiz: company_parts = Σ item cost × qty)', () => {
    it('refreshTotals writes companyCost = Σ quantity × costCompany when the job has lines', async () => {
      ctx.products.findByDeal.mockResolvedValue([
        createMockDealProduct({ lineId: 'a', quantity: 2, priceClient: 50, costCompany: 12.5 }),
        createMockDealProduct({ lineId: 'b', quantity: 1, priceClient: 10, costCompany: 3 }),
      ]);

      await ctx.service.refreshTotals('deal-1');

      expect(ctx.repo.update).toHaveBeenCalledWith('deal-1', expect.objectContaining({ itemCount: 2, companyCost: 28 }));
    });

    it('leaves a typed Company Cost alone while the job has no lines', async () => {
      ctx.repo.findById.mockResolvedValue(createMockDeal({ companyCost: 25, totals: { subtotal: 0, discount: 0, tax: 0, total: 0, cost: 0 } }));
      ctx.products.findByDeal.mockResolvedValue([]);

      await ctx.service.refreshTotals('deal-1');

      expect(ctx.repo.update).toHaveBeenCalledWith('deal-1', expect.not.objectContaining({ companyCost: expect.anything() }));
    });

    it('removing the last line takes the Company Cost the lines gave back to 0 (Workiz: no items, no company parts)', async () => {
      // The stored Company Cost is exactly the lines' last sum — the lines gave it, nobody typed it.
      ctx.repo.findById.mockResolvedValue(createMockDeal({ companyCost: 14, totals: { subtotal: 13, discount: 0, tax: 0, total: 13, cost: 14 } }));
      ctx.products.findByDeal.mockResolvedValue([]);

      await ctx.service.refreshTotals('deal-1');

      expect(ctx.repo.update).toHaveBeenCalledWith('deal-1', expect.objectContaining({ itemCount: 0, companyCost: 0 }));
    });

    it('but keeps an amount typed over the lines’ sum when the last line goes', async () => {
      ctx.repo.findById.mockResolvedValue(createMockDeal({ companyCost: 20, totals: { subtotal: 13, discount: 0, tax: 0, total: 13, cost: 14 } }));
      ctx.products.findByDeal.mockResolvedValue([]);

      await ctx.service.refreshTotals('deal-1');

      expect(ctx.repo.update).toHaveBeenCalledWith('deal-1', expect.not.objectContaining({ companyCost: expect.anything() }));
    });
  });
});
