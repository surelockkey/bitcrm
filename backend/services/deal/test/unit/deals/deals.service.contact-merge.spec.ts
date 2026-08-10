import { Test } from '@nestjs/testing';
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
import { JobTagsService } from 'src/job-tags/job-tags.service';
import { JobStatusesService } from 'src/job-statuses/job-statuses.service';
import { TechnicianEligibilityRepository } from 'src/technician-eligibility/technician-eligibility.repository';
import { CustomFieldsService } from 'src/custom-fields/custom-fields.service';
import { SnsPublisherService, GeocodingService } from '@bitcrm/shared';
import {
  createMockDeal,
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

describe('DealsService.reassignContact', () => {
  let service: DealsService;
  let repo: ReturnType<typeof createMockDealsRepository>;
  let cache: ReturnType<typeof createMockDealsCacheService>;
  let timeline: ReturnType<typeof createMockTimelineRepository>;

  beforeEach(async () => {
    repo = createMockDealsRepository();
    cache = createMockDealsCacheService();
    timeline = createMockTimelineRepository();

    const module = await Test.createTestingModule({
      providers: [
        DealsService,
        { provide: DealsRepository, useValue: repo },
        { provide: DealsCacheService, useValue: cache },
        { provide: TimelineRepository, useValue: timeline },
        { provide: DealProductsRepository, useValue: createMockDealProductsRepository() },
        { provide: SnsPublisherService, useValue: createMockSnsPublisherService() },
        { provide: InternalHttpService, useValue: createMockInternalHttpService() },
        { provide: GeocodingService, useValue: createMockGeocodingService() },
        { provide: ServiceAreasService, useValue: { resolvePoint: jest.fn().mockResolvedValue(null) } },
        { provide: JobTypesService, useValue: { findById: jest.fn().mockResolvedValue(createMockJobType()) } },
        { provide: JobSourcesService, useValue: { findById: jest.fn().mockResolvedValue(createMockJobSource()) } },
        { provide: JobTagsService, useValue: { list: jest.fn().mockResolvedValue([]) } },
        { provide: JobStatusesService, useValue: { findById: jest.fn() } },
        { provide: TechnicianEligibilityRepository, useValue: createMockTechnicianEligibilityRepository() },
        { provide: CustomFieldsService, useValue: createMockCustomFieldsService() },
      ],
    }).compile();

    service = module.get(DealsService);
  });

  it('pages through the old contact deals and re-points each one', async () => {
    const dealA = createMockDeal({ id: 'deal-a', contactId: 'contact-old' });
    const dealB = createMockDeal({ id: 'deal-b', contactId: 'contact-old' });
    const dealC = createMockDeal({ id: 'deal-c', contactId: 'contact-old' });
    repo.findByContact
      .mockResolvedValueOnce({ items: [dealA, dealB], nextCursor: 'cur-1' })
      .mockResolvedValueOnce({ items: [dealC], nextCursor: undefined });

    const count = await service.reassignContact('contact-old', 'contact-new');

    expect(count).toBe(3);
    expect(repo.findByContact).toHaveBeenCalledWith('contact-old', 100, undefined);
    expect(repo.findByContact).toHaveBeenCalledWith('contact-old', 100, 'cur-1');
    expect(repo.reassignContact).toHaveBeenCalledWith('deal-a', 'contact-new');
    expect(repo.reassignContact).toHaveBeenCalledWith('deal-b', 'contact-new');
    expect(repo.reassignContact).toHaveBeenCalledWith('deal-c', 'contact-new');
    expect(cache.invalidate).toHaveBeenCalledWith('deal-a');
    expect(cache.invalidate).toHaveBeenCalledWith('deal-b');
    expect(cache.invalidate).toHaveBeenCalledWith('deal-c');
  });

  it('records a timeline entry per re-pointed deal', async () => {
    const deal = createMockDeal({ id: 'deal-a', contactId: 'contact-old' });
    repo.findByContact.mockResolvedValue({ items: [deal], nextCursor: undefined });

    await service.reassignContact('contact-old', 'contact-new');

    expect(timeline.addEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        dealId: 'deal-a',
        eventType: TimelineEventType.FIELD_UPDATED,
        actorId: 'system',
        details: expect.objectContaining({
          field: 'contactId',
          oldValue: 'contact-old',
          newValue: 'contact-new',
        }),
      }),
    );
  });

  it('returns 0 and writes nothing when the contact has no deals', async () => {
    repo.findByContact.mockResolvedValue({ items: [], nextCursor: undefined });

    const count = await service.reassignContact('contact-old', 'contact-new');

    expect(count).toBe(0);
    expect(repo.reassignContact).not.toHaveBeenCalled();
    expect(timeline.addEntry).not.toHaveBeenCalled();
  });
});
