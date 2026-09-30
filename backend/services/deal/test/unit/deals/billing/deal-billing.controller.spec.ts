import { Test } from '@nestjs/testing';
import { RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { TimelineEventType } from '@bitcrm/types';
import { DealBillingController } from 'src/deals/billing/deal-billing.controller';
import { DealBillingService } from 'src/deals/billing/deal-billing.service';
import { createMockDeal, createMockDealProduct, createMockJwtUser } from '../../mocks';

describe('DealBillingController', () => {
  let controller: DealBillingController;
  let service: Record<string, jest.Mock>;
  const user = createMockJwtUser();

  beforeEach(async () => {
    service = {
      getTotals: jest.fn().mockResolvedValue({ total: 10 }),
      setTax: jest.fn().mockResolvedValue(createMockDeal()),
      autoTax: jest.fn().mockResolvedValue(createMockDeal()),
      setDiscount: jest.fn().mockResolvedValue(createMockDeal()),
      setProductTaxable: jest.fn().mockResolvedValue(createMockDealProduct()),
      getBillingView: jest.fn().mockResolvedValue({ deal: createMockDeal() }),
      replaceAllProducts: jest.fn().mockResolvedValue({ items: [], deal: createMockDeal() }),
      setInvoiceLink: jest.fn(),
      addTimeline: jest.fn(),
      listByContact: jest.fn().mockResolvedValue([]),
    };
    const module = await Test.createTestingModule({
      controllers: [DealBillingController],
      providers: [{ provide: DealBillingService, useValue: service }],
    }).compile();
    controller = module.get(DealBillingController);
  });

  const route = (name: keyof DealBillingController) => {
    const handler = DealBillingController.prototype[name] as unknown as object;
    return {
      path: Reflect.getMetadata(PATH_METADATA, handler),
      method: Reflect.getMetadata(METHOD_METADATA, handler),
    };
  };

  it('exposes the contract paths', () => {
    expect(route('getTotals')).toEqual({ path: ':id/totals', method: RequestMethod.GET });
    expect(route('setTax')).toEqual({ path: ':id/tax', method: RequestMethod.PATCH });
    expect(route('autoTax')).toEqual({ path: ':id/tax/auto', method: RequestMethod.POST });
    expect(route('setDiscount')).toEqual({ path: ':id/discount', method: RequestMethod.PATCH });
    expect(route('setProductTaxable')).toEqual({ path: ':id/products/:productId/taxable', method: RequestMethod.PATCH });
    expect(route('billingView')).toEqual({ path: 'internal/:id/billing-view', method: RequestMethod.GET });
    expect(route('replaceAll')).toEqual({ path: 'internal/:id/products/replace-all', method: RequestMethod.PUT });
    expect(route('invoiceLink')).toEqual({ path: 'internal/:id/invoice-link', method: RequestMethod.PATCH });
    expect(route('addTimeline')).toEqual({ path: 'internal/:id/timeline', method: RequestMethod.POST });
    expect(route('byContact')).toEqual({ path: 'internal/by-contact/:contactId', method: RequestMethod.GET });
  });

  it('wraps results in the envelope', async () => {
    expect(await controller.getTotals('d')).toEqual({ success: true, data: { total: 10 } });

    await controller.setTax('d', { taxRateId: null }, user);
    expect(service.setTax).toHaveBeenCalledWith('d', null, user);

    await controller.autoTax('d', user);
    expect(service.autoTax).toHaveBeenCalledWith('d', user);

    await controller.setDiscount('d', { discount: { type: 'amount', value: 5 } }, user);
    expect(service.setDiscount).toHaveBeenCalledWith('d', { type: 'amount', value: 5 }, user);

    const taxable = await controller.setProductTaxable('d', 'p', { taxable: false }, user);
    expect(service.setProductTaxable).toHaveBeenCalledWith('d', 'p', false, user);
    expect(taxable.success).toBe(true);
  });

  it('delegates the internal routes', async () => {
    expect((await controller.billingView('d')).data.deal.id).toBe('deal-1');

    const dto = { actorId: 'u', estimateNumber: 'E-1', items: [] };
    expect((await controller.replaceAll('d', dto as any)).data.items).toEqual([]);
    expect(service.replaceAllProducts).toHaveBeenCalledWith('d', dto);

    await controller.invoiceLink('d', { invoiceId: 'd' });
    expect(service.setInvoiceLink).toHaveBeenCalledWith('d', 'd');

    const entry = { type: TimelineEventType.INVOICE_SENT, actorId: 'u' };
    await controller.addTimeline('d', entry);
    expect(service.addTimeline).toHaveBeenCalledWith('d', entry);

    expect(await controller.byContact('c')).toEqual({ success: true, data: [] });
  });
});
