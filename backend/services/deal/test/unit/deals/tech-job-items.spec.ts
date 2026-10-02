import { Test } from '@nestjs/testing';
import { GeocodingService, SnsPublisherService } from '@bitcrm/shared';
import { TimelineEventType } from '@bitcrm/types';
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
  createMockJobSource,
  createMockTechnicianEligibilityRepository,
  createMockCustomFieldsService,
} from '../mocks';

/**
 * The owner's ask: "the technician adds items from his container and that
 * forms the price; the dispatcher can add prices too". A technician has no
 * `financials.view`, so inventory hands his phone the price book WITHOUT
 * `costCompany` — the line's costs therefore come from the server's own read
 * of the price book, never from the request.
 */
describe('DealsService — a technician adds, edits and removes items on his own job', () => {
  let service: DealsService;
  let repo: ReturnType<typeof createMockDealsRepository>;
  let products: ReturnType<typeof createMockDealProductsRepository>;
  let http: ReturnType<typeof createMockInternalHttpService>;
  let timeline: ReturnType<typeof createMockTimelineRepository>;

  /** The technician on the job. */
  const tech = createMockJwtUser({ id: 'tech-1', roleId: 'role-technician' });

  /** What inventory's internal route answers for the part: costs included. */
  const catalog = {
    id: 'product-1',
    name: 'Kwikset Deadbolt',
    sku: 'KW-DB-001',
    type: 'product',
    costCompany: 15,
    costTech: 20,
    priceClient: 45,
  };

  /** What the phone sends: no costs — it never saw `costCompany`. */
  const phoneLine = {
    fulfillment: 'sourced' as const,
    sourceTechId: 'tech-1',
    productId: 'product-1',
    name: 'Kwikset Deadbolt',
    sku: 'KW-DB-001',
    quantity: 1,
    priceClient: 45,
  };

  const onHisJob = (over = {}) => createMockDeal({ assignedTechIds: ['tech-1'], ...over });

  beforeEach(async () => {
    repo = createMockDealsRepository();
    products = createMockDealProductsRepository();
    http = createMockInternalHttpService();
    timeline = createMockTimelineRepository();
    http.getProduct.mockResolvedValue(catalog);

    const module = await Test.createTestingModule({
      providers: [
        DealsService,
        { provide: DealsRepository, useValue: repo },
        { provide: DealsCacheService, useValue: createMockDealsCacheService() },
        { provide: TimelineRepository, useValue: timeline },
        { provide: DealProductsRepository, useValue: products },
        { provide: SnsPublisherService, useValue: createMockSnsPublisherService() },
        { provide: InternalHttpService, useValue: http },
        { provide: GeocodingService, useValue: createMockGeocodingService() },
        { provide: ServiceAreasService, useValue: { resolvePoint: jest.fn().mockResolvedValue(null) } },
        { provide: JobTypesService, useValue: { findById: jest.fn().mockResolvedValue(createMockJobType()) } },
        { provide: JobSourcesService, useValue: { findById: jest.fn().mockResolvedValue(createMockJobSource()) } },
        { provide: ExternalCompaniesService, useValue: { findById: jest.fn() } },
        { provide: JobTagsService, useValue: { list: jest.fn().mockResolvedValue([]) } },
        { provide: JobStatusesService, useValue: { findById: jest.fn(), list: jest.fn().mockResolvedValue([]) } },
        { provide: TechnicianEligibilityRepository, useValue: createMockTechnicianEligibilityRepository() },
        { provide: CustomFieldsService, useValue: createMockCustomFieldsService() },
      ],
    }).compile();

    service = module.get(DealsService);
  });

  const written = () => products.addProduct.mock.calls[0][1];

  /* ------------------------------------------------- costs from the catalog */

  describe('the line costs come from the price book', () => {
    it('adds a line the phone sent without costs, filling them in from the catalog', async () => {
      repo.findById.mockResolvedValue(onHisJob());

      await service.addProduct('deal-1', phoneLine as any, tech);

      expect(http.getProduct).toHaveBeenCalledWith('product-1');
      expect(written()).toMatchObject({ costCompany: 15, costForTech: 20, priceClient: 45 });
    });

    it('ignores costs a client sends — the price book is the only source', async () => {
      repo.findById.mockResolvedValue(onHisJob());

      await service.addProduct('deal-1', { ...phoneLine, costCompany: 1, costForTech: 2 } as any, tech);

      expect(written()).toMatchObject({ costCompany: 15, costForTech: 20 });
    });

    it('writes zero for a cost the catalog does not carry', async () => {
      repo.findById.mockResolvedValue(onHisJob());
      http.getProduct.mockResolvedValue({ ...catalog, costCompany: undefined, costTech: undefined });

      await service.addProduct('deal-1', phoneLine as any, tech);

      expect(written()).toMatchObject({ costCompany: 0, costForTech: 0 });
    });

    it('edits a line without costs: the edited line carries the catalog costs', async () => {
      repo.findById.mockResolvedValue(onHisJob());
      products.findProduct.mockResolvedValue(
        createMockDealProduct({ sourceTechId: 'tech-1', costCompany: 10, costForTech: 12 }),
      );

      await service.replaceProduct('deal-1', 'line-1', { ...phoneLine, quantity: 2 } as any, tech);

      expect(written()).toMatchObject({ quantity: 2, costCompany: 15, costForTech: 20 });
    });

    it('logs the cost change the edit actually wrote, not what the request said', async () => {
      repo.findById.mockResolvedValue(onHisJob());
      products.findProduct.mockResolvedValue(
        createMockDealProduct({ sourceTechId: 'tech-1', costCompany: 10, costForTech: 12 }),
      );

      await service.replaceProduct('deal-1', 'line-1', phoneLine as any, tech);

      const entry = timeline.addEntry.mock.calls
        .map(([e]: [any]) => e)
        .find((e: any) => e.eventType === TimelineEventType.PRODUCT_UPDATED);
      expect(entry.details.changes).toEqual({
        costCompany: { from: 10, to: 15 },
        costForTech: { from: 12, to: 20 },
      });
    });
  });
});
