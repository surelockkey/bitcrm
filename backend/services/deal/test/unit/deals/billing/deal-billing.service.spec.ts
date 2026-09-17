import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { TimelineEventType } from '@bitcrm/types';
import { DealBillingService } from 'src/deals/billing/deal-billing.service';
import {
  createMockDeal,
  createMockDealProduct,
  createMockJwtUser,
  createMockDealsRepository,
  createMockDealsCacheService,
  createMockTimelineRepository,
  createMockDealProductsRepository,
  createMockSnsPublisherService,
  createMockInternalHttpService,
  createMockTaxRatesService,
  createMockTaxRate,
  createMockJobType,
  createMockTechnicianEligibilityRepository,
} from '../../mocks';

describe('DealBillingService', () => {
  let repo: ReturnType<typeof createMockDealsRepository>;
  let cache: ReturnType<typeof createMockDealsCacheService>;
  let timeline: ReturnType<typeof createMockTimelineRepository>;
  let products: ReturnType<typeof createMockDealProductsRepository>;
  let http: ReturnType<typeof createMockInternalHttpService>;
  let taxRates: ReturnType<typeof createMockTaxRatesService>;
  let resolver: { resolve: jest.Mock; snapshotOf: jest.Mock };
  let jobTypes: { findById: jest.Mock };
  let eligibility: ReturnType<typeof createMockTechnicianEligibilityRepository>;
  let deals: { findById: jest.Mock };
  let sns: ReturnType<typeof createMockSnsPublisherService>;
  let service: DealBillingService;
  const caller = createMockJwtUser({ id: 'u-1', email: 'u@x.com' });

  let current: ReturnType<typeof createMockDeal>;

  beforeEach(() => {
    repo = createMockDealsRepository();
    cache = createMockDealsCacheService();
    timeline = createMockTimelineRepository();
    products = createMockDealProductsRepository();
    http = createMockInternalHttpService();
    taxRates = createMockTaxRatesService();
    resolver = {
      resolve: jest.fn(),
      snapshotOf: jest.fn((rate, taxSource) => ({
        taxSource, taxRateId: rate.id, taxRateName: rate.name, taxRatePercent: rate.ratePercent,
      })),
    };
    jobTypes = { findById: jest.fn().mockResolvedValue(createMockJobType({ name: 'Lockout' })) };
    eligibility = createMockTechnicianEligibilityRepository();
    current = createMockDeal();
    deals = { findById: jest.fn(async () => current) };
    sns = createMockSnsPublisherService();
    repo.update.mockImplementation(async (_id: string, attrs: Record<string, unknown>) => {
      const next: Record<string, unknown> = { ...current };
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null) delete next[k];
        else if (v !== undefined) next[k] = v;
      }
      current = next as unknown as typeof current;
      return current;
    });
    products.findByDeal.mockResolvedValue([]);

    service = new DealBillingService(
      repo as any,
      cache as any,
      products as any,
      timeline as any,
      http as any,
      taxRates as any,
      resolver as any,
      jobTypes as any,
      eligibility as any,
      deals as any,
      sns as any,
    );
  });

  const entries = (type: TimelineEventType) =>
    timeline.addEntry.mock.calls.map((c) => c[0]).filter((e) => e.eventType === type);

  describe('getTotals', () => {
    it('computes totals from the lines, snapshotted rate and discount', async () => {
      current = createMockDeal({ taxRatePercent: 10, discount: { type: 'amount', value: 20 } });
      products.findByDeal.mockResolvedValue([
        createMockDealProduct({ productId: 'a', quantity: 2, priceClient: 50, taxable: true }),
        createMockDealProduct({ productId: 'b', quantity: 1, priceClient: 100, taxable: false }),
      ]);

      const totals = await service.getTotals('deal-1');

      expect(totals).toMatchObject({
        subtotal: 200, discount: 20, taxableBase: 90, tax: 9, total: 189, balanceDue: 189,
      });
    });

    it('counts a paid job as paid in full', async () => {
      current = createMockDeal({ paymentStatus: 'paid', actualTotal: 45 });
      products.findByDeal.mockResolvedValue([createMockDealProduct()]);
      const totals = await service.getTotals('deal-1');
      expect(totals.amountPaid).toBe(45);
      expect(totals.balanceDue).toBe(0);
    });
  });

  describe('setTax', () => {
    it('sets a manual rate and logs from→to', async () => {
      current = createMockDeal({ taxSource: 'default', taxRateId: 'd', taxRateName: 'D', taxRatePercent: 4 });
      taxRates.findOptional.mockResolvedValue(createMockTaxRate({ id: 'm', name: 'Manual', ratePercent: 6 }));

      const deal = await service.setTax('deal-1', 'm', caller);

      expect(deal).toMatchObject({ taxSource: 'manual', taxRateId: 'm', taxRateName: 'Manual', taxRatePercent: 6 });
      expect(entries(TimelineEventType.TAX_CHANGED)[0].details).toMatchObject({
        from: { taxRateId: 'd', taxSource: 'default' },
        to: { taxRateId: 'm', taxSource: 'manual' },
      });
      expect(cache.invalidate).toHaveBeenCalledWith('deal-1');
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'deal.updated', expect.objectContaining({ dealId: 'deal-1' }));
    });

    it('null clears the rate but stays manual', async () => {
      current = createMockDeal({ taxSource: 'default', taxRateId: 'd', taxRateName: 'D', taxRatePercent: 4 });
      const deal = await service.setTax('deal-1', null, caller);
      expect(deal.taxSource).toBe('manual');
      expect(deal).not.toHaveProperty('taxRateId');
      expect(repo.update).toHaveBeenCalledWith('deal-1', expect.objectContaining({ taxRateId: null }));
    });

    it('rejects an inactive or unknown rate, and a missing key', async () => {
      taxRates.findOptional.mockResolvedValueOnce(createMockTaxRate({ active: false }));
      await expect(service.setTax('deal-1', 'x', caller)).rejects.toThrow(BadRequestException);
      taxRates.findOptional.mockResolvedValueOnce(null);
      await expect(service.setTax('deal-1', 'y', caller)).rejects.toThrow(BadRequestException);
      await expect(service.setTax('deal-1', undefined, caller)).rejects.toThrow(BadRequestException);
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('autoTax', () => {
    it('re-resolves even a manual tax', async () => {
      current = createMockDeal({ taxSource: 'manual', taxRateId: 'm', serviceAreaId: 'area-1', companyId: 'co' });
      resolver.resolve.mockResolvedValue({ taxSource: 'none', taxRateId: null, taxRateName: null, taxRatePercent: null });

      const deal = await service.autoTax('deal-1', caller);

      expect(resolver.resolve).toHaveBeenCalledWith({ contactId: 'contact-1', companyId: 'co', serviceAreaId: 'area-1' });
      expect(deal.taxSource).toBe('none');
      expect(deal).not.toHaveProperty('taxRateId');
      expect(entries(TimelineEventType.TAX_CHANGED)).toHaveLength(1);
    });

    it('skips the write when nothing changes', async () => {
      current = createMockDeal({ taxSource: 'none' });
      resolver.resolve.mockResolvedValue({ taxSource: 'none', taxRateId: null, taxRateName: null, taxRatePercent: null });
      await service.autoTax('deal-1', caller);
      expect(repo.update).not.toHaveBeenCalled();
      expect(timeline.addEntry).not.toHaveBeenCalled();
    });
  });

  describe('setDiscount', () => {
    it('sets and clears the discount with a timeline entry each time', async () => {
      let deal = await service.setDiscount('deal-1', { type: 'percent', value: 10 }, caller);
      expect(deal.discount).toEqual({ type: 'percent', value: 10 });

      deal = await service.setDiscount('deal-1', null, caller);
      expect(deal).not.toHaveProperty('discount');
      expect(repo.update).toHaveBeenLastCalledWith('deal-1', { discount: null });

      const logged = entries(TimelineEventType.DISCOUNT_CHANGED);
      expect(logged[0].details).toEqual({ from: null, to: { type: 'percent', value: 10 } });
      expect(logged[1].details).toEqual({ from: { type: 'percent', value: 10 }, to: null });
    });

    it('rejects a bad discount', async () => {
      await expect(service.setDiscount('deal-1', { type: 'percent', value: 101 }, caller)).rejects.toThrow(BadRequestException);
      await expect(service.setDiscount('deal-1', { type: 'amount', value: -1 }, caller)).rejects.toThrow(BadRequestException);
      await expect(service.setDiscount('deal-1', { type: 'x', value: 1 } as any, caller)).rejects.toThrow(BadRequestException);
      await expect(service.setDiscount('deal-1', undefined, caller)).rejects.toThrow(BadRequestException);
    });
  });

  describe('setProductTaxable', () => {
    it('toggles the flag, logs it and publishes deal.product_updated', async () => {
      products.findProduct.mockResolvedValue(createMockDealProduct({ taxable: true }));
      products.setTaxable.mockResolvedValue(createMockDealProduct({ taxable: false }));

      const line = await service.setProductTaxable('deal-1', 'product-1', false, caller);

      expect(line.taxable).toBe(false);
      expect(products.setTaxable).toHaveBeenCalledWith('deal-1', 'product-1', false);
      expect(entries(TimelineEventType.TAX_CHANGED)[0].details).toMatchObject({
        productId: 'product-1', from: { taxable: true }, to: { taxable: false },
      });
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'deal.product_updated',
        expect.objectContaining({ dealId: 'deal-1', productId: 'product-1', taxable: false }));
    });

    it('404s for a missing line', async () => {
      products.findProduct.mockResolvedValue(null);
      await expect(service.setProductTaxable('deal-1', 'nope', true, caller)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getBillingView', () => {
    it('bundles deal, items, totals, job type and tech names', async () => {
      current = createMockDeal({ assignedTechIds: ['t1', 't2', 't3'] });
      products.findByDeal.mockResolvedValue([createMockDealProduct()]);
      eligibility.get.mockImplementation(async (id: string) =>
        id === 't1' ? { technicianId: 't1', firstName: 'Ann', lastName: 'Lee' }
          : id === 't2' ? { technicianId: 't2', firstName: 'Bo' } : null,
      );

      const view = await service.getBillingView('deal-1');

      expect(view.deal.id).toBe('deal-1');
      expect(view.items).toHaveLength(1);
      expect(view.totals.subtotal).toBe(45);
      expect(view.jobTypeName).toBe('Lockout');
      expect(view.technicianNames).toEqual(['Ann Lee', 'Bo']);
    });

    it("exposes the job's company", async () => {
      current = createMockDeal({ businessProfileId: 'bp-2', businessProfileName: 'Second Brand' });
      const view = await service.getBillingView('deal-1');
      expect(view.businessProfileId).toBe('bp-2');
      expect(view.businessProfileName).toBe('Second Brand');
    });

    it('survives an unknown job type', async () => {
      jobTypes.findById.mockRejectedValue(new NotFoundException());
      const view = await service.getBillingView('deal-1');
      expect(view.jobTypeName).toBeUndefined();
    });
  });

  describe('replaceAllProducts', () => {
    const line = (over: Record<string, unknown> = {}) => ({
      productId: 'p1', productType: 'product', name: 'Deadbolt', sku: 'DB', quantity: 1,
      priceClient: 50, costCompany: 10, costForTech: 12, taxable: true, ...over,
    });
    const dto = (over: Record<string, unknown> = {}) => ({
      actorId: 'u-1', actorName: 'Ann', estimateNumber: 'AB12CD-1', items: [line()], ...over,
    });

    it('restores removed sourced lines and writes the merged new set', async () => {
      current = createMockDeal({ assignedTechIds: ['t1'] });
      products.findByDeal
        .mockResolvedValueOnce([
          createMockDealProduct({ productId: 'old', quantity: 2, fulfillment: 'sourced', sourceTechId: 't1' }),
          createMockDealProduct({ productId: 'svc-old', fulfillment: 'service' }),
        ])
        .mockResolvedValue([createMockDealProduct({ productId: 'p1' })]);

      const result = await service.replaceAllProducts('deal-1', dto({
        items: [
          line({ quantity: 1 }),
          line({ quantity: 2, description: 'dup' }),
          line({ productId: 's1', productType: 'service', name: 'Labor', taxable: false }),
        ],
      }) as any);

      expect(http.restoreStock).toHaveBeenCalledTimes(1);
      expect(http.restoreStock).toHaveBeenCalledWith(expect.objectContaining({
        containerId: 't1',
        items: [{ productId: 'old', productName: 'Kwikset Deadbolt', quantity: 2 }],
      }));
      // Duplicates merged by productId → one deduction of 3.
      expect(http.deductStock).toHaveBeenCalledTimes(1);
      expect(http.deductStock).toHaveBeenCalledWith(expect.objectContaining({
        containerId: 't1',
        items: [{ productId: 'p1', productName: 'Deadbolt', quantity: 3 }],
      }));
      expect(products.removeProduct).toHaveBeenCalledWith('deal-1', 'old');
      expect(products.removeProduct).toHaveBeenCalledWith('deal-1', 'svc-old');
      const written = products.addProduct.mock.calls.map((c) => c[1]);
      expect(written).toEqual([
        expect.objectContaining({ productId: 'p1', quantity: 3, fulfillment: 'sourced', sourceTechId: 't1', taxable: true }),
        expect.objectContaining({ productId: 's1', fulfillment: 'service', taxable: false }),
      ]);
      expect(written[1]).not.toHaveProperty('sourceTechId');
      expect(repo.update).toHaveBeenCalledWith('deal-1', expect.objectContaining({ itemCount: 2 }));
      expect(entries(TimelineEventType.ESTIMATE_SYNCED)[0]).toMatchObject({
        actorId: 'u-1', actorName: 'Ann', details: { estimateNumber: 'AB12CD-1', itemCount: 2 },
      });
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'deal.updated', expect.any(Object));
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'deal.products_replaced',
        expect.objectContaining({ dealId: 'deal-1', itemCount: 2 }));
      expect(cache.invalidate).toHaveBeenCalledWith('deal-1');
      expect(result.items).toHaveLength(1);
      expect(result.deal.id).toBe('deal-1');
    });

    it('tries the next assigned tech, then falls back to to_order', async () => {
      current = createMockDeal({ assignedTechIds: ['t1', 't2'] });
      http.deductStock.mockImplementation(async ({ containerId, items }: any) => {
        if (containerId === 't1') throw new HttpException('Insufficient stock', 400);
        if (items[0].productId === 'p2') throw new HttpException('Insufficient stock', 400);
      });

      await service.replaceAllProducts('deal-1', dto({
        items: [line(), line({ productId: 'p2', name: 'Knob' })],
      }) as any);

      const written = products.addProduct.mock.calls.map((c) => c[1]);
      expect(written[0]).toMatchObject({ productId: 'p1', fulfillment: 'sourced', sourceTechId: 't2' });
      expect(written[1]).toMatchObject({ productId: 'p2', fulfillment: 'to_order' });
    });

    it('uses to_order when nobody is assigned and looks up unknown product types', async () => {
      http.getProduct.mockResolvedValue({ id: 'p1', type: 'service' });
      await service.replaceAllProducts('deal-1', dto({ items: [line({ productType: undefined })] }) as any);
      expect(http.getProduct).toHaveBeenCalledWith('p1');
      expect(products.addProduct.mock.calls[0][1].fulfillment).toBe('service');

      http.getProduct.mockResolvedValue({ id: 'p1', type: 'product' });
      await service.replaceAllProducts('deal-1', dto({ items: [line({ productType: undefined })] }) as any);
      expect(products.addProduct.mock.calls[1][1].fulfillment).toBe('to_order');
      expect(http.deductStock).not.toHaveBeenCalled();
    });

    it('rolls back applied stock moves when a later step fails', async () => {
      current = createMockDeal({ assignedTechIds: ['t1'] });
      products.findByDeal.mockResolvedValueOnce([
        createMockDealProduct({ productId: 'old', quantity: 2, fulfillment: 'sourced', sourceTechId: 't1' }),
      ]);
      http.deductStock
        .mockResolvedValueOnce(undefined) // p1 deducted
        .mockRejectedValueOnce(new Error('inventory down')) // p2 → 5xx-ish
        .mockResolvedValue(undefined); // rollback re-deduct of `old`

      await expect(
        service.replaceAllProducts('deal-1', dto({ items: [line(), line({ productId: 'p2' })] }) as any),
      ).rejects.toThrow('inventory down');

      // p1's deduction is restored, then `old`'s restore is re-deducted.
      expect(http.restoreStock).toHaveBeenLastCalledWith(expect.objectContaining({
        containerId: 't1', items: [expect.objectContaining({ productId: 'p1', quantity: 1 })],
      }));
      expect(http.deductStock).toHaveBeenLastCalledWith(expect.objectContaining({
        containerId: 't1', items: [expect.objectContaining({ productId: 'old', quantity: 2 })],
      }));
      expect(products.addProduct).not.toHaveBeenCalled();
      expect(products.removeProduct).not.toHaveBeenCalled();
    });

    it('applies a manual tax rate and discount when provided', async () => {
      taxRates.findOptional.mockResolvedValue(createMockTaxRate({ id: 'r', name: 'R', ratePercent: 5, active: false }));

      const { deal } = await service.replaceAllProducts('deal-1', dto({
        taxRateId: 'r', discount: { type: 'amount', value: 5 },
      }) as any);

      expect(deal).toMatchObject({
        taxSource: 'manual', taxRateId: 'r', taxRatePercent: 5, discount: { type: 'amount', value: 5 },
      });
    });

    it('leaves tax and discount alone when omitted, and clears them on null', async () => {
      current = createMockDeal({ taxSource: 'default', taxRateId: 'd', discount: { type: 'amount', value: 1 } });
      await service.replaceAllProducts('deal-1', dto() as any);
      expect(repo.update.mock.calls[0][1]).toEqual({ itemCount: 1 });

      await service.replaceAllProducts('deal-1', dto({ taxRateId: null, discount: null }) as any);
      expect(repo.update.mock.calls[1][1]).toMatchObject({
        itemCount: 1, taxSource: 'manual', taxRateId: null, discount: null,
      });
    });

    it('keeps a legacy (catalog) taxRateId the job already carries', async () => {
      current = createMockDeal({ taxSource: 'service_area', taxRateId: 'legacy', taxRateName: 'Old', taxRatePercent: 4 });
      taxRates.findOptional.mockResolvedValue(null);

      await service.replaceAllProducts('deal-1', dto({ taxRateId: 'legacy' }) as any);
      expect(repo.update.mock.calls[0][1]).toEqual({ itemCount: 1 });
    });

    it("falls back to the estimate's own snapshot for an id that no longer resolves", async () => {
      taxRates.findOptional.mockResolvedValue(null);

      const { deal } = await service.replaceAllProducts('deal-1', dto({
        taxRateId: 'gone', taxRateName: 'Old Tax', taxRatePercent: 5.5,
      }) as any);
      expect(deal).toMatchObject({ taxSource: 'manual', taxRateId: 'gone', taxRateName: 'Old Tax', taxRatePercent: 5.5 });
    });

    it('rejects an unresolvable taxRateId with no snapshot', async () => {
      taxRates.findOptional.mockResolvedValue(null);
      await expect(
        service.replaceAllProducts('deal-1', dto({ taxRateId: 'gone' }) as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an unknown catalog product with no type given', async () => {
      http.getProduct.mockResolvedValue(null);
      await expect(
        service.replaceAllProducts('deal-1', dto({ items: [line({ productType: undefined })] }) as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('setInvoiceLink', () => {
    it('sets and clears invoiceId', async () => {
      await service.setInvoiceLink('deal-1', 'deal-1');
      expect(repo.update).toHaveBeenCalledWith('deal-1', { invoiceId: 'deal-1' });
      await service.setInvoiceLink('deal-1', null);
      expect(repo.update).toHaveBeenLastCalledWith('deal-1', { invoiceId: null });
      expect(cache.invalidate).toHaveBeenCalledWith('deal-1');
      await expect(service.setInvoiceLink('deal-1', undefined)).rejects.toThrow(BadRequestException);
    });
  });

  describe('addTimeline', () => {
    it('writes an entry for an existing deal', async () => {
      await service.addTimeline('deal-1', {
        type: TimelineEventType.INVOICE_CREATED, actorId: 'u-1', metadata: { total: 10 },
      });
      expect(deals.findById).toHaveBeenCalledWith('deal-1');
      expect(timeline.addEntry).toHaveBeenCalledWith(expect.objectContaining({
        dealId: 'deal-1', eventType: 'invoice_created', actorId: 'u-1', actorName: 'Billing', details: { total: 10 },
      }));
    });
  });

  describe('listByContact', () => {
    it('drains the contact index into a light list', async () => {
      repo.findByContact
        .mockResolvedValueOnce({ items: [createMockDeal({ id: 'a' })], nextCursor: 'c' })
        .mockResolvedValueOnce({
          items: [createMockDeal({ id: 'b', dealNumber: 'ZZ', businessProfileId: 'bp-2', businessProfileName: 'Two' })],
        });

      expect(await service.listByContact('contact-1')).toEqual([
        { id: 'a', dealNumber: 'AB12CD', superStatus: 'submitted' },
        { id: 'b', dealNumber: 'ZZ', superStatus: 'submitted', businessProfileId: 'bp-2', businessProfileName: 'Two' },
      ]);
    });
  });
});
