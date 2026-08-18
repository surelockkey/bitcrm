import { BadRequestException } from '@nestjs/common';
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

describe('DealsService — custom fields', () => {
  let service: DealsService;
  let repo: ReturnType<typeof createMockDealsRepository>;
  let cache: ReturnType<typeof createMockDealsCacheService>;
  let timeline: ReturnType<typeof createMockTimelineRepository>;
  let customFields: ReturnType<typeof createMockCustomFieldsService>;

  const caller = createMockJwtUser({ id: 'dispatcher-1', roleId: 'role-dispatcher' });
  const baseDto = {
    contactId: 'contact-1',
    clientType: ClientType.RESIDENTIAL,
    serviceArea: 'Atlanta Metro',
    address: { street: '123 Main', city: 'Atlanta', state: 'GA', zip: '30301' },
    jobTypeId: 'jobtype-1',
  };

  beforeEach(async () => {
    repo = createMockDealsRepository();
    cache = createMockDealsCacheService();
    timeline = createMockTimelineRepository();
    customFields = createMockCustomFieldsService();

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
        { provide: CustomFieldsService, useValue: customFields },
      ],
    }).compile();

    service = module.get(DealsService);
    repo.reserveDealNumber.mockResolvedValue('K4T9ZW');
    repo.create.mockResolvedValue(undefined);
  });

  function mockFindById(deal = createMockDeal()) {
    cache.get.mockResolvedValue(null);
    repo.findById.mockResolvedValue(deal);
    return deal;
  }

  describe('create', () => {
    it('rejects an unknown custom field id', async () => {
      customFields.list.mockResolvedValue([createMockCustomField({ id: 'cf-known' })]);

      await expect(
        service.create({ ...baseDto, customFields: { 'cf-unknown': 'x' } } as any, caller),
      ).rejects.toThrow(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects an inactive custom field id', async () => {
      customFields.list.mockResolvedValue([
        createMockCustomField({ id: 'cf-1', active: false }),
      ]);

      await expect(
        service.create({ ...baseDto, customFields: { 'cf-1': 'x' } } as any, caller),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a wrong-typed value (number field given a string)', async () => {
      customFields.list.mockResolvedValue([
        createMockCustomField({ id: 'cf-num', type: 'number' }),
      ]);

      await expect(
        service.create({ ...baseDto, customFields: { 'cf-num': 'not-a-number' } } as any, caller),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a dropdown value outside the defined options', async () => {
      customFields.list.mockResolvedValue([
        createMockCustomField({ id: 'cf-dd', type: 'dropdown', options: ['A', 'B'] }),
      ]);

      await expect(
        service.create({ ...baseDto, customFields: { 'cf-dd': 'C' } } as any, caller),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a missing required applicable field', async () => {
      customFields.list.mockResolvedValue([
        createMockCustomField({ id: 'cf-req', name: 'Gate Code', type: 'text', required: true }),
      ]);

      await expect(
        service.create({ ...baseDto, customFields: {} } as any, caller),
      ).rejects.toThrow(/Gate Code/);
    });

    it('rejects a value for a field scoped to a different job type', async () => {
      customFields.list.mockResolvedValue([
        createMockCustomField({ id: 'cf-scoped', type: 'text', jobTypeIds: ['other-jobtype'] }),
      ]);

      await expect(
        service.create({ ...baseDto, customFields: { 'cf-scoped': 'x' } } as any, caller),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a list of attachment ids for a file field (Workiz allows up to 5)', async () => {
      customFields.list.mockResolvedValue([
        createMockCustomField({ id: 'cf-file', type: 'file' }),
      ]);

      const result = await service.create(
        { ...baseDto, customFields: { 'cf-file': ['att-1', 'att-2'] } } as any,
        caller,
      );

      expect(result.customFields).toEqual({ 'cf-file': ['att-1', 'att-2'] });
    });

    it('rejects a file field with more than 5 files or non-string entries', async () => {
      customFields.list.mockResolvedValue([
        createMockCustomField({ id: 'cf-file', type: 'file' }),
      ]);

      await expect(
        service.create(
          { ...baseDto, customFields: { 'cf-file': ['1', '2', '3', '4', '5', '6'] } } as any,
          caller,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create({ ...baseDto, customFields: { 'cf-file': [7] } } as any, caller),
      ).rejects.toThrow(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('accepts valid values and passes them to repository.create', async () => {
      customFields.list.mockResolvedValue([
        createMockCustomField({ id: 'cf-text', type: 'text' }),
        createMockCustomField({ id: 'cf-dd', type: 'dropdown', options: ['A', 'B'] }),
      ]);

      const result = await service.create(
        { ...baseDto, customFields: { 'cf-text': 'hello', 'cf-dd': 'A' } } as any,
        caller,
      );

      expect(result.customFields).toEqual({ 'cf-text': 'hello', 'cf-dd': 'A' });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ customFields: { 'cf-text': 'hello', 'cf-dd': 'A' } }),
      );
    });
  });

  describe('update', () => {
    it('patches a single custom field and writes a timeline diff labeled with the field name', async () => {
      const deal = mockFindById(
        createMockDeal({ customFields: { 'cf-1': 'old', 'cf-2': 'keep' } }),
      );
      repo.update.mockResolvedValue(deal);
      customFields.list.mockResolvedValue([
        createMockCustomField({ id: 'cf-1', name: 'Gate Code', type: 'text' }),
        createMockCustomField({ id: 'cf-2', name: 'Alarm Code', type: 'text' }),
      ]);

      await service.update('deal-1', { customFields: { 'cf-1': 'new' } } as any, caller);

      // Merge semantics: the untouched key is preserved in the written map.
      expect(repo.update).toHaveBeenCalledWith(
        'deal-1',
        expect.objectContaining({ customFields: { 'cf-1': 'new', 'cf-2': 'keep' } }),
      );
      // One diff, labeled with the human name — not the raw id.
      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: TimelineEventType.FIELD_UPDATED,
          details: { field: 'Gate Code', oldValue: 'old', newValue: 'new' },
        }),
      );
      expect(timeline.addEntry).toHaveBeenCalledTimes(1);
    });
  });
});
