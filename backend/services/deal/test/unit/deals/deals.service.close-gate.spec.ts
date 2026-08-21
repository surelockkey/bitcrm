import { UnprocessableEntityException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JobSuperStatus } from '@bitcrm/types';
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
import { SnsPublisherService, GeocodingService } from '@bitcrm/shared';
import {
  createMockDeal,
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
  createMockCustomField,
  createMockCustomFieldsService,
  createMockTechnicianEligibilityRepository,
} from '../mocks';

describe('DealsService — required-to-close gate', () => {
  let service: DealsService;
  let repo: ReturnType<typeof createMockDealsRepository>;
  let cache: ReturnType<typeof createMockDealsCacheService>;
  let customFields: ReturnType<typeof createMockCustomFieldsService>;

  const caller = createMockJwtUser({ id: 'dispatcher-1', roleId: 'role-dispatcher' });

  beforeEach(async () => {
    repo = createMockDealsRepository();
    cache = createMockDealsCacheService();
    customFields = createMockCustomFieldsService();

    const module = await Test.createTestingModule({
      providers: [
        DealsService,
        { provide: DealsRepository, useValue: repo },
        { provide: DealsCacheService, useValue: cache },
        { provide: TimelineRepository, useValue: createMockTimelineRepository() },
        { provide: DealProductsRepository, useValue: createMockDealProductsRepository() },
        { provide: SnsPublisherService, useValue: createMockSnsPublisherService() },
        { provide: InternalHttpService, useValue: createMockInternalHttpService() },
        { provide: GeocodingService, useValue: createMockGeocodingService() },
        { provide: ServiceAreasService, useValue: { resolvePoint: jest.fn().mockResolvedValue(null) } },
        { provide: JobTypesService, useValue: { findById: jest.fn().mockResolvedValue(createMockJobType()) } },
        { provide: JobSourcesService, useValue: { findById: jest.fn().mockResolvedValue(createMockJobSource()) } },
        { provide: ExternalCompaniesService, useValue: { findById: jest.fn().mockResolvedValue({ id: 'extco-1', active: true }) } },
        { provide: JobTagsService, useValue: { list: jest.fn().mockResolvedValue([]) } },
        { provide: JobStatusesService, useValue: { findById: jest.fn() } },
        { provide: TechnicianEligibilityRepository, useValue: createMockTechnicianEligibilityRepository() },
        { provide: CustomFieldsService, useValue: customFields },
      ],
    }).compile();

    service = module.get(DealsService);
  });

  function mockFindById(deal = createMockDeal()) {
    cache.get.mockResolvedValue(null);
    repo.findById.mockResolvedValue(deal);
    repo.update.mockResolvedValue(deal);
    return deal;
  }

  it('blocks a move to a terminal status when a requiredToClose field is unfilled, listing its name and id (422)', async () => {
    mockFindById(
      createMockDeal({ superStatus: JobSuperStatus.IN_PROGRESS, jobTypeId: 'jobtype-1', customFields: {} }),
    );
    customFields.list.mockResolvedValue([
      createMockCustomField({ id: 'cf-permit', name: 'Permit Number', type: 'text', requiredToClose: true }),
    ]);

    const error = await service
      .moveStatus('deal-1', { superStatus: JobSuperStatus.DONE }, caller)
      .catch((e) => e);

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error.getStatus()).toBe(422);
    const payload = error.getResponse() as { missingFields: Array<{ id: string; name: string }> };
    expect(payload.missingFields).toEqual([{ id: 'cf-permit', name: 'Permit Number' }]);
    // The status was never actually written.
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('allows the same terminal move once the requiredToClose field is filled', async () => {
    const deal = mockFindById(
      createMockDeal({
        superStatus: JobSuperStatus.IN_PROGRESS,
        jobTypeId: 'jobtype-1',
        customFields: { 'cf-permit': 'PN-12345' },
      }),
    );
    repo.update.mockResolvedValue({ ...deal, superStatus: JobSuperStatus.DONE });
    customFields.list.mockResolvedValue([
      createMockCustomField({ id: 'cf-permit', name: 'Permit Number', type: 'text', requiredToClose: true }),
    ]);

    await service.moveStatus('deal-1', { superStatus: JobSuperStatus.DONE }, caller);

    expect(repo.update).toHaveBeenCalledWith(
      'deal-1',
      expect.objectContaining({ superStatus: JobSuperStatus.DONE }),
    );
  });

  it('ignores requiredToClose on a non-terminal transition', async () => {
    const deal = mockFindById(
      createMockDeal({ superStatus: JobSuperStatus.SUBMITTED, jobTypeId: 'jobtype-1', customFields: {} }),
    );
    repo.update.mockResolvedValue({ ...deal, superStatus: JobSuperStatus.IN_PROGRESS });
    customFields.list.mockResolvedValue([
      createMockCustomField({ id: 'cf-permit', name: 'Permit Number', type: 'text', requiredToClose: true }),
    ]);

    await service.moveStatus('deal-1', { superStatus: JobSuperStatus.IN_PROGRESS }, caller);

    expect(repo.update).toHaveBeenCalledWith(
      'deal-1',
      expect.objectContaining({ superStatus: JobSuperStatus.IN_PROGRESS }),
    );
  });

  it('does not block on a requiredToClose field scoped to a different job type', async () => {
    const deal = mockFindById(
      createMockDeal({ superStatus: JobSuperStatus.IN_PROGRESS, jobTypeId: 'jobtype-1', customFields: {} }),
    );
    repo.update.mockResolvedValue({ ...deal, superStatus: JobSuperStatus.DONE });
    customFields.list.mockResolvedValue([
      createMockCustomField({
        id: 'cf-scoped',
        name: 'Elevator Code',
        type: 'text',
        requiredToClose: true,
        jobTypeIds: ['other-jobtype'],
      }),
    ]);

    await service.moveStatus('deal-1', { superStatus: JobSuperStatus.DONE }, caller);

    expect(repo.update).toHaveBeenCalledWith(
      'deal-1',
      expect.objectContaining({ superStatus: JobSuperStatus.DONE }),
    );
  });
});
