import { Test } from '@nestjs/testing';
import { GeocodingService, SnsPublisherService } from '@bitcrm/shared';
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

/** DealsService with every collaborator mocked — the job-line specs' common ground. */
export async function buildLineItemsService() {
  const repo = createMockDealsRepository();
  const products = createMockDealProductsRepository();
  const http = createMockInternalHttpService();
  const timeline = createMockTimelineRepository();
  const sns = createMockSnsPublisherService();

  const module = await Test.createTestingModule({
    providers: [
      DealsService,
      { provide: DealsRepository, useValue: repo },
      { provide: DealsCacheService, useValue: createMockDealsCacheService() },
      { provide: TimelineRepository, useValue: timeline },
      { provide: DealProductsRepository, useValue: products },
      { provide: SnsPublisherService, useValue: sns },
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

  return { service: module.get(DealsService), repo, products, http, timeline, sns };
}
