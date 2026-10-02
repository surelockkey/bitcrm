import { createMockDeal, createMockDealProduct, createMockJwtUser } from '../mocks';
import { buildLineItemsService } from './line-items.fixture';

/**
 * Workiz "Edit item" on a job line shows the inventory item's custom fields
 * (ALL SKU, In Store Location, Link_UHS…). The line gets its own copy when it
 * is added — keyed by the field NAME, as the product keeps them — and that
 * copy is the line's: editing it never touches the product.
 */
describe('DealsService — custom field values on a job line', () => {
  let ctx: Awaited<ReturnType<typeof buildLineItemsService>>;

  const dispatcher = createMockJwtUser({ id: 'dispatcher-1', roleId: 'role-dispatcher' });

  const catalog = {
    id: 'product-1',
    name: 'Kwikset Deadbolt',
    sku: 'KW-DB-001',
    type: 'product',
    costCompany: 15,
    costTech: 20,
    priceClient: 45,
    customAttributes: { 'In Store Location': 'Aisle 4', Link_UHS: 'https://uhs.example/kw' },
  };

  const line = {
    fulfillment: 'to_order' as const,
    productId: 'product-1',
    name: 'Kwikset Deadbolt',
    sku: 'KW-DB-001',
    quantity: 1,
    priceClient: 45,
  };

  const written = () => ctx.products.addProduct.mock.calls[0][1];

  beforeEach(async () => {
    ctx = await buildLineItemsService();
    ctx.http.getProduct.mockResolvedValue(catalog);
    ctx.repo.findById.mockResolvedValue(createMockDeal({ assignedTechIds: ['tech-1'] }));
  });

  describe('adding a line', () => {
    it("copies the product's values onto the line", async () => {
      await ctx.service.addProduct('deal-1', line as any, dispatcher);

      expect(written().customAttributes).toEqual({
        'In Store Location': 'Aisle 4',
        Link_UHS: 'https://uhs.example/kw',
      });
    });

    it('takes the values the request sends instead, keeping only the filled ones', async () => {
      await ctx.service.addProduct(
        'deal-1',
        { ...line, customAttributes: { 'In Store Location': 'Van shelf 2', Link_UHS: '', SKU_CRM: null } } as any,
        dispatcher,
      );

      expect(written().customAttributes).toEqual({ 'In Store Location': 'Van shelf 2' });
    });

    it('writes no customAttributes at all when neither the product nor the request has any', async () => {
      ctx.http.getProduct.mockResolvedValue({ ...catalog, customAttributes: undefined });

      await ctx.service.addProduct('deal-1', line as any, dispatcher);

      expect(written()).not.toHaveProperty('customAttributes');
    });
  });

  describe('editing a line (PUT …/products/:lineId)', () => {
    const existing = (over = {}) =>
      createMockDealProduct({
        fulfillment: 'to_order',
        sourceTechId: undefined,
        customAttributes: { 'In Store Location': 'Aisle 9' },
        ...over,
      });

    it('saves the values the edit sends — on the line only, the product is never written', async () => {
      ctx.products.findProduct.mockResolvedValue(existing());

      await ctx.service.replaceProduct(
        'deal-1',
        'line-1',
        { ...line, customAttributes: { 'In Store Location': 'Back room', ALL_SKU_RELATED: 'KW-1, KW-2' } } as any,
        dispatcher,
      );

      expect(written().customAttributes).toEqual({ 'In Store Location': 'Back room', ALL_SKU_RELATED: 'KW-1, KW-2' });
      // Inventory is only read: the price book entry keeps its own values.
      const calledInventory = Object.entries(ctx.http)
        .filter(([, fn]) => (fn as jest.Mock).mock.calls.length > 0)
        .map(([name]) => name);
      expect(calledInventory).toEqual(['getProduct']);
    });

    it("keeps the line's own values when the edit does not send any", async () => {
      ctx.products.findProduct.mockResolvedValue(existing());

      await ctx.service.replaceProduct('deal-1', 'line-1', { ...line, quantity: 3 } as any, dispatcher);

      expect(written().customAttributes).toEqual({ 'In Store Location': 'Aisle 9' });
    });

    it("clears them all when the edit sends every field empty", async () => {
      ctx.products.findProduct.mockResolvedValue(existing());

      await ctx.service.replaceProduct(
        'deal-1',
        'line-1',
        { ...line, customAttributes: { 'In Store Location': '' } } as any,
        dispatcher,
      );

      expect(written()).not.toHaveProperty('customAttributes');
    });

    it("starts from the new product's values on a swap", async () => {
      ctx.products.findProduct.mockResolvedValue(existing({ productId: 'product-9' }));

      await ctx.service.replaceProduct('deal-1', 'line-1', line as any, dispatcher);

      expect(written().customAttributes).toEqual(catalog.customAttributes);
    });
  });
});
