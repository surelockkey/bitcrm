import { Test } from '@nestjs/testing';
import { ClientType, TimelineEventType } from '@bitcrm/types';
import { DealsService } from 'src/deals/deals.service';
import { DealsRepository } from 'src/deals/deals.repository';
import { DealsCacheService } from 'src/deals/deals-cache.service';
import { TimelineRepository } from 'src/timeline/timeline.repository';
import { DealProductsRepository } from 'src/products/deal-products.repository';
import { InternalHttpService } from 'src/common/services/internal-http.service';
import { ServiceAreasService } from 'src/service-areas/service-areas.service';
import { JobTypesService } from 'src/job-types/job-types.service';
import { JobSourcesService } from 'src/job-sources/job-sources.service';
import { ExternalCompaniesService } from 'src/external-companies/external-companies.service';
import { JobTagsService } from 'src/job-tags/job-tags.service';
import { JobStatusesService } from 'src/job-statuses/job-statuses.service';
import { TechnicianEligibilityRepository } from 'src/technician-eligibility/technician-eligibility.repository';
import { CustomFieldsService } from 'src/custom-fields/custom-fields.service';
import { DealTaxResolver } from 'src/deals/billing/deal-tax.resolver';
import { SnsPublisherService, GeocodingService } from '@bitcrm/shared';
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
  createMockGeocodingService,
  createMockJobType,
  createMockServiceArea,
  createMockTechnicianEligibilityRepository,
  createMockCustomFieldsService,
} from '../mocks';

/** Billing hooks inside DealsService: tax resolution, itemCount, line taxable/description. */
describe('DealsService — billing', () => {
  let service: DealsService;
  let repo: ReturnType<typeof createMockDealsRepository>;
  let cache: ReturnType<typeof createMockDealsCacheService>;
  let timeline: ReturnType<typeof createMockTimelineRepository>;
  let products: ReturnType<typeof createMockDealProductsRepository>;
  let http: ReturnType<typeof createMockInternalHttpService>;
  let serviceAreas: { resolvePoint: jest.Mock; findById: jest.Mock };
  let resolver: { resolve: jest.Mock };
  const caller = createMockJwtUser({ id: 'dispatcher-1' });

  const areaTax = {
    taxSource: 'service_area', taxRateId: 'tax-a', taxRateName: 'Fulton', taxRatePercent: 8.9,
  };

  beforeEach(async () => {
    repo = createMockDealsRepository();
    cache = createMockDealsCacheService();
    timeline = createMockTimelineRepository();
    products = createMockDealProductsRepository();
    http = createMockInternalHttpService();
    serviceAreas = {
      resolvePoint: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(createMockServiceArea({ id: 'area-2', name: 'North' })),
    };
    resolver = { resolve: jest.fn().mockResolvedValue(areaTax) };

    const module = await Test.createTestingModule({
      providers: [
        DealsService,
        { provide: DealsRepository, useValue: repo },
        { provide: DealsCacheService, useValue: cache },
        { provide: TimelineRepository, useValue: timeline },
        { provide: DealProductsRepository, useValue: products },
        { provide: SnsPublisherService, useValue: createMockSnsPublisherService() },
        { provide: InternalHttpService, useValue: http },
        { provide: GeocodingService, useValue: createMockGeocodingService() },
        { provide: ServiceAreasService, useValue: serviceAreas },
        { provide: JobTypesService, useValue: { findById: jest.fn().mockResolvedValue(createMockJobType()) } },
        { provide: JobSourcesService, useValue: { findById: jest.fn() } },
        { provide: ExternalCompaniesService, useValue: { findById: jest.fn() } },
        { provide: JobTagsService, useValue: { list: jest.fn().mockResolvedValue([]) } },
        { provide: JobStatusesService, useValue: { findById: jest.fn() } },
        { provide: CustomFieldsService, useValue: createMockCustomFieldsService() },
        { provide: TechnicianEligibilityRepository, useValue: createMockTechnicianEligibilityRepository() },
        { provide: DealTaxResolver, useValue: resolver },
      ],
    }).compile();

    service = module.get(DealsService);
  });

  function mockFindById(deal = createMockDeal()) {
    cache.get.mockResolvedValue(null);
    repo.findById.mockResolvedValue(deal);
    return deal;
  }

  const timelineTypes = () => timeline.addEntry.mock.calls.map((c) => c[0].eventType);

  describe('create', () => {
    it('snapshots the resolved tax and starts with zero items', async () => {
      repo.reserveDealNumber.mockResolvedValue('K4T9ZW');
      serviceAreas.resolvePoint.mockResolvedValue(createMockServiceArea({ id: 'area-1' }));

      const deal = await service.create(
        {
          contactId: 'contact-1',
          companyId: 'co-1',
          clientType: ClientType.RESIDENTIAL,
          address: { street: '1 Main', city: 'Atlanta', state: 'GA', zip: '30301' },
          jobTypeId: 'jobtype-1',
        } as any,
        caller,
      );

      expect(resolver.resolve).toHaveBeenCalledWith({
        contactId: 'contact-1', companyId: 'co-1', serviceAreaId: 'area-1',
      });
      expect(deal).toMatchObject({
        taxSource: 'service_area', taxRateId: 'tax-a', taxRateName: 'Fulton', taxRatePercent: 8.9, itemCount: 0,
      });
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ taxRateId: 'tax-a', itemCount: 0 }));
    });

    it('stores no rate fields for an exempt client', async () => {
      repo.reserveDealNumber.mockResolvedValue('K4T9ZW');
      resolver.resolve.mockResolvedValue({
        taxSource: 'exempt', taxRateId: null, taxRateName: null, taxRatePercent: null,
      });

      const deal = await service.create(
        {
          contactId: 'contact-1',
          clientType: ClientType.RESIDENTIAL,
          address: { street: '1 Main', city: 'Atlanta', state: 'GA', zip: '30301' },
          jobTypeId: 'jobtype-1',
        } as any,
        caller,
      );
      expect(deal.taxSource).toBe('exempt');
      expect(deal).not.toHaveProperty('taxRateId');
    });
  });

  describe('update', () => {
    it('re-resolves tax when the service area changes, logging TAX_CHANGED only', async () => {
      const deal = mockFindById(createMockDeal({
        serviceAreaId: 'area-1', taxSource: 'default', taxRateId: 'tax-d', taxRateName: 'GA', taxRatePercent: 4,
      }));
      repo.update.mockResolvedValue(deal);

      await service.update('deal-1', { serviceAreaId: 'area-2' } as any, caller);

      expect(resolver.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ contactId: 'contact-1', serviceAreaId: 'area-2' }),
      );
      expect(repo.update).toHaveBeenCalledWith('deal-1', expect.objectContaining({
        serviceAreaId: 'area-2', taxSource: 'service_area', taxRateId: 'tax-a', taxRatePercent: 8.9,
      }));
      const taxEntry = timeline.addEntry.mock.calls.find((c) => c[0].eventType === TimelineEventType.TAX_CHANGED)![0];
      expect(taxEntry.details).toMatchObject({
        from: { taxRateId: 'tax-d', taxSource: 'default' },
        to: { taxRateId: 'tax-a', taxSource: 'service_area' },
      });
      const fields = timeline.addEntry.mock.calls
        .filter((c) => c[0].eventType === TimelineEventType.FIELD_UPDATED)
        .map((c) => c[0].details.field);
      expect(fields).not.toContain('taxRateId');
      expect(fields).not.toContain('taxSource');
    });

    it('reprices the job under the new tax', async () => {
      const deal = mockFindById(createMockDeal({ serviceAreaId: 'area-1', taxSource: 'default', taxRatePercent: 4 }));
      repo.update.mockResolvedValue(deal);
      repo.findById.mockResolvedValueOnce(deal).mockResolvedValue({ ...deal, taxRatePercent: 10 });
      products.findByDeal.mockResolvedValue([createMockDealProduct({ quantity: 1, priceClient: 100, costCompany: 0 })]);

      await service.update('deal-1', { serviceAreaId: 'area-2' } as any, caller);

      expect(repo.update).toHaveBeenCalledWith('deal-1', expect.objectContaining({
        totals: expect.objectContaining({ tax: 10, total: 110 }),
      }));
    });

    it('does not reprice an edit that leaves the tax alone', async () => {
      const deal = mockFindById(createMockDeal({ serviceAreaId: 'area-1' }));
      repo.update.mockResolvedValue(deal);

      await service.update('deal-1', { notes: 'x' } as any, caller);

      expect(products.findByDeal).not.toHaveBeenCalled();
    });

    it('leaves a manual tax alone', async () => {
      const deal = mockFindById(createMockDeal({ serviceAreaId: 'area-1', taxSource: 'manual', taxRateId: 'm' }));
      repo.update.mockResolvedValue(deal);

      await service.update('deal-1', { serviceAreaId: 'area-2' } as any, caller);

      expect(resolver.resolve).not.toHaveBeenCalled();
      expect(repo.update.mock.calls[0][1]).not.toHaveProperty('taxRateId');
    });

    it('does not re-resolve when the service area is unchanged', async () => {
      const deal = mockFindById(createMockDeal({ serviceAreaId: 'area-1' }));
      repo.update.mockResolvedValue(deal);

      await service.update('deal-1', { notes: 'x' } as any, caller);
      expect(resolver.resolve).not.toHaveBeenCalled();
    });

    it('writes nothing extra when the resolved tax is identical', async () => {
      const deal = mockFindById(createMockDeal({ serviceAreaId: 'area-1', ...areaTax } as any));
      repo.update.mockResolvedValue(deal);

      await service.update('deal-1', { serviceAreaId: 'area-2' } as any, caller);

      expect(repo.update.mock.calls[0][1]).not.toHaveProperty('taxRateId');
      expect(timelineTypes()).not.toContain(TimelineEventType.TAX_CHANGED);
    });
  });

  describe('changeContact', () => {
    it('re-resolves tax for the new client', async () => {
      mockFindById(createMockDeal({ serviceAreaId: 'area-1', taxSource: 'default', taxRateId: 'd' }));
      resolver.resolve.mockResolvedValue({
        taxSource: 'exempt', taxRateId: null, taxRateName: null, taxRatePercent: null,
      });

      await service.changeContact('deal-1', 'contact-2', caller);

      expect(resolver.resolve).toHaveBeenCalledWith(expect.objectContaining({ contactId: 'contact-2' }));
      expect(repo.update).toHaveBeenCalledWith('deal-1', expect.objectContaining({
        taxSource: 'exempt', taxRateId: null,
      }));
      expect(timelineTypes()).toContain(TimelineEventType.TAX_CHANGED);
      expect(repo.update).toHaveBeenCalledWith('deal-1', expect.objectContaining({ totals: expect.any(Object) }));
    });

    it('keeps a manual tax on client change', async () => {
      mockFindById(createMockDeal({ taxSource: 'manual' }));
      await service.changeContact('deal-1', 'contact-2', caller);
      expect(resolver.resolve).not.toHaveBeenCalled();
    });
  });

  describe('line items', () => {
    const lineDto = {
      productId: 'product-1', name: 'Rekey', sku: 'RK', quantity: 1,
      costCompany: 1, costForTech: 1, priceClient: 50, fulfillment: 'to_order' as const,
    };

    it("defaults taxable to the catalog product's flag and stores the description", async () => {
      mockFindById();
      http.getProduct.mockResolvedValue({ id: 'product-1', type: 'product', taxable: false });
      products.findByDeal.mockResolvedValue([createMockDealProduct({ quantity: 1, priceClient: 50, costCompany: 1 })]);

      await service.addProduct('deal-1', { ...lineDto, description: 'Front door' } as any, caller);

      expect(products.addProduct).toHaveBeenCalledWith('deal-1', expect.objectContaining({
        taxable: false, description: 'Front door',
      }));
      expect(repo.update).toHaveBeenCalledWith('deal-1', {
        itemCount: 1,
        totals: { subtotal: 50, discount: 0, tax: 0, total: 50, cost: 1 },
      });
    });

    it('lets the request override taxable and defaults to true otherwise', async () => {
      mockFindById();
      await service.addProduct('deal-1', { ...lineDto, taxable: false } as any, caller);
      expect(products.addProduct.mock.calls[0][1].taxable).toBe(false);

      await service.addProduct('deal-1', lineDto as any, caller);
      expect(products.addProduct.mock.calls[1][1].taxable).toBe(true);
    });

    it('keeps the existing taxable/description on an in-place edit', async () => {
      mockFindById();
      products.findProduct.mockResolvedValue(createMockDealProduct({
        fulfillment: 'to_order', taxable: false, description: 'Old',
      }));
      products.findByDeal.mockResolvedValue([
        createMockDealProduct({ lineId: 'a', quantity: 2, priceClient: 50, costCompany: 1 }),
        createMockDealProduct({ lineId: 'b', quantity: 1, priceClient: 10, costCompany: 2 }),
        createMockDealProduct({ lineId: 'c', quantity: 1, priceClient: 10, costCompany: 2 }),
      ]);

      await service.replaceProduct('deal-1', 'product-1', { ...lineDto, quantity: 2 } as any, caller);

      expect(products.addProduct).toHaveBeenCalledWith('deal-1', expect.objectContaining({
        quantity: 2, taxable: false, description: 'Old',
      }));
      expect(repo.update).toHaveBeenCalledWith('deal-1', expect.objectContaining({
        itemCount: 3,
        totals: expect.objectContaining({ subtotal: 120, cost: 6 }),
      }));
    });

    it("uses the new product's default on a swap", async () => {
      mockFindById();
      products.findProduct.mockImplementation(async (_d: string, pid: string) =>
        pid === 'product-1' ? createMockDealProduct({ fulfillment: 'to_order', taxable: false }) : null,
      );
      http.getProduct.mockResolvedValue({ id: 'product-2', type: 'product' });

      await service.replaceProduct('deal-1', 'product-1', { ...lineDto, productId: 'product-2' } as any, caller);

      expect(products.addProduct.mock.calls[0][1]).toMatchObject({ productId: 'product-2', taxable: true });
    });

    it('recounts items on remove', async () => {
      mockFindById();
      products.findProduct.mockResolvedValue(createMockDealProduct({ fulfillment: 'service' }));
      products.findByDeal.mockResolvedValue([]);

      await service.removeProduct('deal-1', 'product-1', caller);

      expect(repo.update).toHaveBeenCalledWith('deal-1', {
        itemCount: 0,
        totals: { subtotal: 0, discount: 0, tax: 0, total: 0, cost: 0 },
      });
      expect(cache.invalidate).toHaveBeenCalledWith('deal-1');
    });

    it('prices the lines against a fresh, consistent read of the job and its lines', async () => {
      const deal = mockFindById(createMockDeal({ taxRatePercent: 10 }));
      products.findProduct.mockResolvedValue(createMockDealProduct({ fulfillment: 'service' }));
      products.findByDeal.mockResolvedValue([createMockDealProduct({ quantity: 1, priceClient: 100, costCompany: 0 })]);

      await service.removeProduct('deal-1', 'product-1', caller);

      expect(repo.findById).toHaveBeenCalledWith(deal.id, { consistent: true });
      expect(products.findByDeal).toHaveBeenCalledWith(deal.id, { consistent: true });
      expect(repo.update).toHaveBeenCalledWith('deal-1', expect.objectContaining({
        totals: expect.objectContaining({ tax: 10, total: 110 }),
      }));
    });
  });

  describe('list', () => {
    it('passes needsInvoice through as a filter', async () => {
      repo.findAll.mockResolvedValue({ items: [] });
      await service.list({ needsInvoice: 'true' } as any, caller);
      expect(repo.findAll).toHaveBeenCalledWith(20, undefined, expect.objectContaining({ needsInvoice: true }));

      repo.findBySuperStatus.mockResolvedValue({ items: [] });
      await service.list({ superStatus: 'submitted', needsInvoice: true } as any, caller);
      expect(repo.findBySuperStatus.mock.calls[0][3]).toMatchObject({ needsInvoice: true });
    });
  });
});
