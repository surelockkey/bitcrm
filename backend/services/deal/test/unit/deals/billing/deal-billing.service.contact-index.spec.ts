import { TimelineEventType } from '@bitcrm/types';
import { DealBillingService } from 'src/deals/billing/deal-billing.service';
import {
  createMockDeal,
  createMockDealProductsRepository,
  createMockDealsCacheService,
  createMockDealsRepository,
  createMockInternalHttpService,
  createMockJobType,
  createMockJwtUser,
  createMockSnsPublisherService,
  createMockTaxRatesService,
  createMockTechnicianEligibilityRepository,
  createMockTimelineRepository,
} from '../../mocks';

/**
 * Billing's events on a job (discount, tax, documents written through the
 * internal route) are part of the client's history too, so every entry the
 * billing service writes names the job's client.
 */
describe('DealBillingService — timeline entries carry the job’s contactId', () => {
  let repo: ReturnType<typeof createMockDealsRepository>;
  let timeline: ReturnType<typeof createMockTimelineRepository>;
  let deals: { findById: jest.Mock; refreshTotals: jest.Mock };
  let service: DealBillingService;
  const caller = createMockJwtUser({ id: 'u-1', email: 'u@x.com' });
  let current: ReturnType<typeof createMockDeal>;

  beforeEach(() => {
    repo = createMockDealsRepository();
    timeline = createMockTimelineRepository();
    current = createMockDeal({ id: 'deal-1', contactId: 'contact-9' });
    deals = { findById: jest.fn(async () => current), refreshTotals: jest.fn() };
    repo.update.mockImplementation(async (_id: string, attrs: Record<string, unknown>) => {
      current = { ...current, ...attrs } as typeof current;
      return current;
    });
    const products = createMockDealProductsRepository();
    products.findByDeal.mockResolvedValue([]);

    service = new DealBillingService(
      repo as any,
      createMockDealsCacheService() as any,
      products as any,
      timeline as any,
      createMockInternalHttpService() as any,
      createMockTaxRatesService() as any,
      { resolve: jest.fn(), snapshotOf: jest.fn() } as any,
      { findById: jest.fn().mockResolvedValue(createMockJobType()) } as any,
      createMockTechnicianEligibilityRepository() as any,
      deals as any,
      createMockSnsPublisherService() as any,
    );
  });

  const entries = () => timeline.addEntry.mock.calls.map((c) => c[0]);

  it('setDiscount files the discount change under the client', async () => {
    await service.setDiscount('deal-1', { type: 'amount', value: 20 }, caller);
    expect(entries()).toEqual([
      expect.objectContaining({ eventType: TimelineEventType.DISCOUNT_CHANGED, dealId: 'deal-1', contactId: 'contact-9' }),
    ]);
  });

  it('the internal timeline route (billing documents) files the entry under the client', async () => {
    await service.addTimeline('deal-1', {
      type: TimelineEventType.INVOICE_CREATED,
      actorId: 'u-1',
      metadata: { invoiceNumber: 'AB12CD' },
    });
    expect(entries()).toEqual([
      expect.objectContaining({
        eventType: TimelineEventType.INVOICE_CREATED,
        dealId: 'deal-1',
        contactId: 'contact-9',
        details: { invoiceNumber: 'AB12CD' },
      }),
    ]);
    // One read of the job is enough — it is what verified the job exists.
    expect(deals.findById).toHaveBeenCalledTimes(1);
  });
});
