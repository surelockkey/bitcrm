import { ForbiddenException } from '@nestjs/common';
import { DataScope } from '@bitcrm/types';
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
  createMockTechnicianEligibilityRepository,
} from '../../mocks';

/**
 * The job's tax and discount are writes to the job, so the `deals` data scope
 * holds for them as for its items: a technician (`assigned_only`) may change
 * them only on a job he is on the roster of.
 */
describe('DealBillingService — tax and discount stay within the deals data scope', () => {
  let repo: ReturnType<typeof createMockDealsRepository>;
  let products: ReturnType<typeof createMockDealProductsRepository>;
  let taxRates: ReturnType<typeof createMockTaxRatesService>;
  let resolver: { resolve: jest.Mock; snapshotOf: jest.Mock };
  let deals: { findById: jest.Mock; refreshTotals: jest.Mock };
  let service: DealBillingService;
  let job: ReturnType<typeof createMockDeal>;

  const tech = createMockJwtUser({ id: 'tech-1', roleId: 'role-technician' });
  const scope = DataScope.ASSIGNED_ONLY;

  beforeEach(() => {
    repo = createMockDealsRepository();
    products = createMockDealProductsRepository();
    taxRates = createMockTaxRatesService();
    resolver = {
      resolve: jest.fn().mockResolvedValue({ taxSource: 'none', taxRateId: null, taxRateName: null, taxRatePercent: null }),
      snapshotOf: jest.fn((rate, taxSource) => ({
        taxSource, taxRateId: rate.id, taxRateName: rate.name, taxRatePercent: rate.ratePercent,
      })),
    };
    job = createMockDeal({ assignedTechIds: ['tech-2'], taxSource: 'default', taxRateId: 'd', taxRatePercent: 4 });
    deals = { findById: jest.fn(async () => job), refreshTotals: jest.fn() };
    repo.update.mockImplementation(async () => job);
    taxRates.findOptional.mockResolvedValue(createMockTaxRate({ id: 'm', name: 'Manual', ratePercent: 6 }));
    products.findProduct.mockResolvedValue(createMockDealProduct({ taxable: true }));
    products.setTaxable.mockResolvedValue(createMockDealProduct({ taxable: false }));

    service = new DealBillingService(
      repo as any,
      createMockDealsCacheService() as any,
      products as any,
      createMockTimelineRepository() as any,
      createMockInternalHttpService() as any,
      taxRates as any,
      resolver as any,
      { findById: jest.fn() } as any,
      createMockTechnicianEligibilityRepository() as any,
      deals as any,
      createMockSnsPublisherService() as any,
    );
  });

  describe("on someone else's job — 403 and nothing written", () => {
    it('setting the tax by hand', async () => {
      await expect(service.setTax('deal-1', 'm', tech, scope)).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('re-resolving the tax', async () => {
      await expect(service.autoTax('deal-1', tech, scope)).rejects.toBeInstanceOf(ForbiddenException);
      expect(resolver.resolve).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('setting the discount', async () => {
      await expect(
        service.setDiscount('deal-1', { type: 'percent', value: 10 }, tech, scope),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("flipping a line's taxable flag", async () => {
      await expect(
        service.setProductTaxable('deal-1', 'line-1', false, tech, scope),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(products.setTaxable).not.toHaveBeenCalled();
    });
  });

  it('allows all four on his own job', async () => {
    job = createMockDeal({ assignedTechIds: ['tech-1'] });

    await service.setTax('deal-1', 'm', tech, scope);
    await service.autoTax('deal-1', tech, scope);
    await service.setDiscount('deal-1', { type: 'amount', value: 5 }, tech, scope);
    await service.setProductTaxable('deal-1', 'line-1', false, tech, scope);

    expect(products.setTaxable).toHaveBeenCalledWith('deal-1', 'line-1', false);
    expect(repo.update).toHaveBeenCalled();
  });

  it('leaves a wider scope (the office) unrestricted', async () => {
    const dispatcher = createMockJwtUser({ id: 'dispatcher-1' });

    await service.setDiscount('deal-1', { type: 'amount', value: 5 }, dispatcher, DataScope.DEPARTMENT);

    expect(repo.update).toHaveBeenCalledWith('deal-1', { discount: { type: 'amount', value: 5 } });
  });
});
