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
import { JobRulesService } from 'src/job-rules/job-rules.service';
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
  createMockCustomFieldsService,
  createMockTechnicianEligibilityRepository,
} from '../mocks';

/**
 * Workiz "Update Job End Time" (Account → Preferences, ON): a job marked Done
 * or Canceled ends at that moment, so the "Job end date" reports — the
 * account's default report basis — list it on the day it was closed. The
 * repository restamps the EndIndex from the fields written here.
 */
describe('DealsService — the job end time on Done / Canceled', () => {
  let service: DealsService;
  let repo: ReturnType<typeof createMockDealsRepository>;
  let cache: ReturnType<typeof createMockDealsCacheService>;
  let serviceAreas: { resolvePoint: jest.Mock; findById: jest.Mock };
  let jobRules: { get: jest.Mock };
  const caller = createMockJwtUser({ id: 'dispatcher-1', roleId: 'role-dispatcher' });

  beforeEach(async () => {
    repo = createMockDealsRepository();
    cache = createMockDealsCacheService();
    serviceAreas = { resolvePoint: jest.fn().mockResolvedValue(null), findById: jest.fn().mockResolvedValue({ id: 'area-ct', timezone: 'America/New_York' }) };
    jobRules = { get: jest.fn().mockResolvedValue({ updateJobEndTimeOnClose: true }) };

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
        { provide: ServiceAreasService, useValue: serviceAreas },
        { provide: JobTypesService, useValue: { findById: jest.fn().mockResolvedValue(createMockJobType()) } },
        { provide: JobSourcesService, useValue: { findById: jest.fn().mockResolvedValue(createMockJobSource()) } },
        { provide: ExternalCompaniesService, useValue: { findById: jest.fn().mockResolvedValue({ id: 'extco-1', active: true }) } },
        { provide: JobTagsService, useValue: { list: jest.fn().mockResolvedValue([]) } },
        { provide: JobStatusesService, useValue: { findById: jest.fn() } },
        { provide: TechnicianEligibilityRepository, useValue: createMockTechnicianEligibilityRepository() },
        { provide: CustomFieldsService, useValue: createMockCustomFieldsService() },
        { provide: JobRulesService, useValue: jobRules },
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

  const patchOfLastUpdate = () => repo.update.mock.calls.at(-1)![1] as Record<string, unknown>;

  it('moves the end to the closing moment in the job\'s area zone when a job is Done', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-20T18:30:00.000Z'));
    try {
      mockFindById(createMockDeal({ superStatus: JobSuperStatus.IN_PROGRESS, serviceAreaId: 'area-ct', scheduledDate: '2026-04-20', scheduledTimeSlot: '09:00-12:00' }));

      await service.moveStatus('deal-1', { superStatus: JobSuperStatus.DONE }, caller);

      expect(patchOfLastUpdate()).toMatchObject({
        closedAt: '2026-04-20T18:30:00.000Z',
        scheduledEndDate: '2026-04-20',
        scheduledTimeSlot: '09:00-14:30',
        jobEndDateUtc: '2026-04-20T18:30:00.000Z',
        jobTimezone: 'America/New_York',
      });
      expect(serviceAreas.findById).toHaveBeenCalledWith('area-ct');
    } finally {
      jest.useRealTimers();
    }
  });

  it('…and when it is Canceled, days after the visit', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-02T13:05:00.000Z'));
    try {
      mockFindById(createMockDeal({ superStatus: JobSuperStatus.SUBMITTED, scheduledDate: '2026-04-20', scheduledTimeSlot: '09:00-12:00' }));

      await service.moveStatus('deal-1', { superStatus: JobSuperStatus.CANCELED, cancellationReason: 'No show' }, caller);

      expect(patchOfLastUpdate()).toMatchObject({ scheduledEndDate: '2026-05-02', scheduledTimeSlot: '09:00-09:05' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('leaves the visit alone when the account switched the rule off', async () => {
    jobRules.get.mockResolvedValue({ updateJobEndTimeOnClose: false });
    mockFindById(createMockDeal({ superStatus: JobSuperStatus.IN_PROGRESS, scheduledDate: '2026-04-20', scheduledTimeSlot: '09:00-12:00' }));

    await service.moveStatus('deal-1', { superStatus: JobSuperStatus.DONE }, caller);

    const patch = patchOfLastUpdate();
    expect(patch.closedAt).toEqual(expect.any(String));
    expect(patch).not.toHaveProperty('scheduledEndDate');
    expect(patch).not.toHaveProperty('scheduledTimeSlot');
    expect(patch).not.toHaveProperty('jobEndDateUtc');
  });

  it('only a close moves the end: Done Pending Approval and a reopen do not', async () => {
    mockFindById(createMockDeal({ superStatus: JobSuperStatus.IN_PROGRESS, scheduledDate: '2026-04-20', scheduledTimeSlot: '09:00-12:00' }));
    await service.moveStatus('deal-1', { superStatus: JobSuperStatus.DONE_PENDING_APPROVAL }, caller);
    expect(patchOfLastUpdate()).not.toHaveProperty('jobEndDateUtc');

    mockFindById(createMockDeal({ superStatus: JobSuperStatus.DONE, closedAt: '2026-04-20T18:30:00.000Z', scheduledDate: '2026-04-20', scheduledTimeSlot: '09:00-14:30' }));
    await service.moveStatus('deal-1', { superStatus: JobSuperStatus.IN_PROGRESS }, caller);
    expect(patchOfLastUpdate()).not.toHaveProperty('jobEndDateUtc');
    expect(patchOfLastUpdate()).not.toHaveProperty('scheduledTimeSlot');
  });

  it('an area that cannot be read costs the zone, not the close', async () => {
    serviceAreas.findById.mockRejectedValue(new Error('gone'));
    mockFindById(createMockDeal({ superStatus: JobSuperStatus.IN_PROGRESS, serviceAreaId: 'area-x', scheduledDate: '2026-04-20', scheduledTimeSlot: '09:00-12:00' }));

    await service.moveStatus('deal-1', { superStatus: JobSuperStatus.DONE }, caller);

    expect(patchOfLastUpdate()).toMatchObject({ superStatus: JobSuperStatus.DONE, jobTimezone: 'America/New_York' });
  });
});
