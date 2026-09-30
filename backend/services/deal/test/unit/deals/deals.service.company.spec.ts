import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
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
import { BusinessProfilesClient } from 'src/common/services/business-profiles.client';
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
  createMockBusinessProfilesClient,
} from '../mocks';

/** R2.2: every job belongs to one of the business's companies (billing business profiles). */
describe('DealsService — company (business profile)', () => {
  let service: DealsService;
  let repo: ReturnType<typeof createMockDealsRepository>;
  let cache: ReturnType<typeof createMockDealsCacheService>;
  let timeline: ReturnType<typeof createMockTimelineRepository>;
  let sns: ReturnType<typeof createMockSnsPublisherService>;
  let serviceAreas: { resolvePoint: jest.Mock; findById: jest.Mock };
  let companies: ReturnType<typeof createMockBusinessProfilesClient>;
  const caller = createMockJwtUser({ id: 'dispatcher-1' });

  const newDeal = (over: Record<string, unknown> = {}) =>
    ({
      contactId: 'contact-1',
      clientType: ClientType.RESIDENTIAL,
      address: { street: '1 Main', city: 'Atlanta', state: 'GA', zip: '30301' },
      jobTypeId: 'jobtype-1',
      ...over,
    }) as any;

  beforeEach(async () => {
    repo = createMockDealsRepository();
    cache = createMockDealsCacheService();
    timeline = createMockTimelineRepository();
    sns = createMockSnsPublisherService();
    serviceAreas = {
      resolvePoint: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(createMockServiceArea({ id: 'area-2', name: 'North' })),
    };
    companies = createMockBusinessProfilesClient();
    companies.findDefault.mockResolvedValue({ id: 'bp-default', name: 'Default Co', isDefault: true, active: true });
    repo.reserveDealNumber.mockResolvedValue('K4T9ZW');
    repo.update.mockImplementation(async (id: string, attrs: Record<string, unknown>) => ({
      ...createMockDeal({ id }),
      ...attrs,
    }));

    const module = await Test.createTestingModule({
      providers: [
        DealsService,
        { provide: DealsRepository, useValue: repo },
        { provide: DealsCacheService, useValue: cache },
        { provide: TimelineRepository, useValue: timeline },
        { provide: DealProductsRepository, useValue: createMockDealProductsRepository() },
        { provide: SnsPublisherService, useValue: sns },
        { provide: InternalHttpService, useValue: createMockInternalHttpService() },
        { provide: GeocodingService, useValue: createMockGeocodingService() },
        { provide: ServiceAreasService, useValue: serviceAreas },
        { provide: JobTypesService, useValue: { findById: jest.fn().mockResolvedValue(createMockJobType()) } },
        { provide: JobSourcesService, useValue: { findById: jest.fn() } },
        { provide: ExternalCompaniesService, useValue: { findById: jest.fn() } },
        { provide: JobTagsService, useValue: { list: jest.fn().mockResolvedValue([]) } },
        { provide: JobStatusesService, useValue: { findById: jest.fn() } },
        { provide: CustomFieldsService, useValue: createMockCustomFieldsService() },
        { provide: TechnicianEligibilityRepository, useValue: createMockTechnicianEligibilityRepository() },
        { provide: DealTaxResolver, useValue: { resolve: jest.fn().mockResolvedValue({ taxSource: 'none', taxRateId: null, taxRateName: null, taxRatePercent: null }) } },
        { provide: BusinessProfilesClient, useValue: companies },
      ],
    }).compile();

    service = module.get(DealsService);
  });

  function mockFindById(deal = createMockDeal()) {
    cache.get.mockResolvedValue(null);
    repo.findById.mockResolvedValue(deal);
    return deal;
  }

  describe('create', () => {
    it('uses an explicit company and snapshots its name', async () => {
      const deal = await service.create(newDeal({ businessProfileId: 'bp-2' }), caller);
      expect(companies.resolve).toHaveBeenCalledWith('bp-2');
      expect(deal).toMatchObject({ businessProfileId: 'bp-2', businessProfileName: 'Company bp-2' });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ businessProfileId: 'bp-2', businessProfileName: 'Company bp-2' }),
      );
    });

    it('rejects an unknown or archived explicit company', async () => {
      companies.resolve.mockRejectedValueOnce(new BadRequestException('Company x not found'));
      await expect(service.create(newDeal({ businessProfileId: 'x' }), caller)).rejects.toThrow(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("defaults to the service area's default company", async () => {
      serviceAreas.findById.mockResolvedValue(
        createMockServiceArea({ id: 'area-2', name: 'North', defaultBusinessProfileId: 'bp-north' }),
      );
      const deal = await service.create(newDeal({ serviceAreaId: 'area-2' }), caller);
      expect(deal).toMatchObject({ businessProfileId: 'bp-north', businessProfileName: 'Company bp-north' });
      expect(companies.findDefault).not.toHaveBeenCalled();
    });

    it("uses the auto-resolved area's default company too", async () => {
      serviceAreas.resolvePoint.mockResolvedValue(
        createMockServiceArea({ id: 'area-1', defaultBusinessProfileId: 'bp-geo' }),
      );
      const deal = await service.create(newDeal(), caller);
      expect(deal.businessProfileId).toBe('bp-geo');
    });

    it("falls back to billing's default company when the area has none (or its default is gone)", async () => {
      expect((await service.create(newDeal(), caller))).toMatchObject({
        businessProfileId: 'bp-default', businessProfileName: 'Default Co',
      });

      serviceAreas.findById.mockResolvedValue(
        createMockServiceArea({ id: 'area-2', defaultBusinessProfileId: 'bp-archived' }),
      );
      companies.resolve.mockRejectedValueOnce(new BadRequestException('archived'));
      expect((await service.create(newDeal({ serviceAreaId: 'area-2' }), caller)).businessProfileId).toBe('bp-default');
    });

    it('leaves the company unset when billing has no default (or is down)', async () => {
      companies.findDefault.mockResolvedValue(null);
      const deal = await service.create(newDeal(), caller);
      expect(deal).not.toHaveProperty('businessProfileId');
      expect(deal).not.toHaveProperty('businessProfileName');
    });

    it('accepts an unverified id without a name when billing is down', async () => {
      companies.resolve.mockResolvedValueOnce({ id: 'bp-9' });
      const deal = await service.create(newDeal({ businessProfileId: 'bp-9' }), caller);
      expect(deal.businessProfileId).toBe('bp-9');
      expect(deal).not.toHaveProperty('businessProfileName');
    });
  });

  describe('update', () => {
    it('changes the company, snapshots the name, logs one FIELD_UPDATED and publishes deal.updated', async () => {
      mockFindById(createMockDeal({ businessProfileId: 'bp-1', businessProfileName: 'One' }));

      await service.update('deal-1', { businessProfileId: 'bp-2' } as any, caller);

      expect(repo.update).toHaveBeenCalledWith(
        'deal-1',
        expect.objectContaining({ businessProfileId: 'bp-2', businessProfileName: 'Company bp-2' }),
      );
      const fieldEntries = timeline.addEntry.mock.calls
        .map((c) => c[0])
        .filter((e) => e.eventType === TimelineEventType.FIELD_UPDATED);
      expect(fieldEntries).toHaveLength(1);
      expect(fieldEntries[0].details).toEqual({
        field: 'businessProfileId',
        oldValue: 'bp-1',
        newValue: 'bp-2',
        oldLabel: 'One',
        newLabel: 'Company bp-2',
      });
      expect(sns.publish).toHaveBeenCalledWith(
        'deal-events',
        'deal.updated',
        expect.objectContaining({ dealId: 'deal-1', businessProfileId: 'bp-2' }),
      );
    });

    it('clears the company on null (name too)', async () => {
      mockFindById(createMockDeal({ businessProfileId: 'bp-1', businessProfileName: 'One' }));
      await service.update('deal-1', { businessProfileId: null } as any, caller);
      expect(repo.update).toHaveBeenCalledWith(
        'deal-1',
        expect.objectContaining({ businessProfileId: null, businessProfileName: null }),
      );
      expect(companies.resolve).not.toHaveBeenCalled();
    });

    it('is a no-op for the same id (no validation, no timeline entry)', async () => {
      mockFindById(createMockDeal({ businessProfileId: 'bp-1', businessProfileName: 'One' }));
      await service.update('deal-1', { businessProfileId: 'bp-1', notes: 'x' } as any, caller);
      expect(companies.resolve).not.toHaveBeenCalled();
      const fields = timeline.addEntry.mock.calls.map((c) => c[0].details.field);
      expect(fields).not.toContain('businessProfileId');
      expect(fields).not.toContain('businessProfileName');
    });

    it('rejects an unknown company', async () => {
      mockFindById();
      companies.resolve.mockRejectedValueOnce(new BadRequestException('nope'));
      await expect(service.update('deal-1', { businessProfileId: 'x' } as any, caller)).rejects.toThrow(
        BadRequestException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('leaves the company alone when absent from the body', async () => {
      mockFindById(createMockDeal({ businessProfileId: 'bp-1' }));
      await service.update('deal-1', { notes: 'hello' } as any, caller);
      expect(repo.update.mock.calls[0][1]).not.toHaveProperty('businessProfileId');
      expect(repo.update.mock.calls[0][1]).not.toHaveProperty('businessProfileName');
    });
  });

  describe('list', () => {
    it('passes ?businessProfileId through as a filter', async () => {
      repo.findAll.mockResolvedValue({ items: [] });
      await service.list({ businessProfileId: 'bp-2' } as any, caller);
      expect(repo.findAll).toHaveBeenCalledWith(
        expect.any(Number),
        undefined,
        expect.objectContaining({ businessProfileId: 'bp-2' }),
      );
    });
  });
});
