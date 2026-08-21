import { NotFoundException, BadRequestException, ForbiddenException, HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DealStage, DealStageGroup, JobSuperStatus, DealStatus, TimelineEventType, DealPriority, ClientType } from '@bitcrm/types';
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
import { JobFieldSettingsService } from 'src/job-field-settings/job-field-settings.service';
import { SnsPublisherService, GeocodingService } from '@bitcrm/shared';
import {
  createMockDeal,
  createMockDealProduct,
  createMockTimelineEntry,
  createMockJwtUser,
  createMockAddress,
  createMockDealsRepository,
  createMockDealsCacheService,
  createMockTimelineRepository,
  createMockDealProductsRepository,
  createMockSnsPublisherService,
  createMockInternalHttpService,
  createMockGeocodingService,
  createMockJobType,
  createMockJobSource,
  createMockJobTag,
  createMockTechnicianEligibilityRepository,
  createMockCustomFieldsService,
  createMockExternalCompany,
} from '../mocks';

describe('DealsService', () => {
  let service: DealsService;
  let repo: ReturnType<typeof createMockDealsRepository>;
  let cache: ReturnType<typeof createMockDealsCacheService>;
  let timeline: ReturnType<typeof createMockTimelineRepository>;
  let products: ReturnType<typeof createMockDealProductsRepository>;
  let sns: ReturnType<typeof createMockSnsPublisherService>;
  let http: ReturnType<typeof createMockInternalHttpService>;
  let serviceAreas: { resolvePoint: jest.Mock };
  let jobTypes: { findById: jest.Mock };
  let jobSources: { findById: jest.Mock };
  let externalCompanies: { findById: jest.Mock };
  let jobTags: { list: jest.Mock };
  let jobStatuses: { findById: jest.Mock };
  let eligibility: ReturnType<typeof createMockTechnicianEligibilityRepository>;
  let jobFieldSettings: { missingRequiredForCreate: jest.Mock };

  beforeEach(async () => {
    repo = createMockDealsRepository();
    cache = createMockDealsCacheService();
    timeline = createMockTimelineRepository();
    products = createMockDealProductsRepository();
    sns = createMockSnsPublisherService();
    http = createMockInternalHttpService();
    serviceAreas = { resolvePoint: jest.fn().mockResolvedValue(null) };
    jobTypes = { findById: jest.fn().mockResolvedValue(createMockJobType()) };
    jobSources = { findById: jest.fn().mockResolvedValue(createMockJobSource()) };
    externalCompanies = { findById: jest.fn().mockResolvedValue(createMockExternalCompany()) };
    jobTags = { list: jest.fn().mockResolvedValue([]) };
    jobStatuses = { findById: jest.fn() };
    eligibility = createMockTechnicianEligibilityRepository();
    jobFieldSettings = { missingRequiredForCreate: jest.fn().mockResolvedValue([]) };

    const module = await Test.createTestingModule({
      providers: [
        DealsService,
        { provide: DealsRepository, useValue: repo },
        { provide: DealsCacheService, useValue: cache },
        { provide: TimelineRepository, useValue: timeline },
        { provide: DealProductsRepository, useValue: products },
        { provide: SnsPublisherService, useValue: sns },
        { provide: InternalHttpService, useValue: http },
        { provide: GeocodingService, useValue: createMockGeocodingService() },
        { provide: ServiceAreasService, useValue: serviceAreas },
        { provide: JobTypesService, useValue: jobTypes },
        { provide: JobSourcesService, useValue: jobSources },
        { provide: ExternalCompaniesService, useValue: externalCompanies },
        { provide: JobTagsService, useValue: jobTags },
        { provide: JobStatusesService, useValue: jobStatuses },
        { provide: CustomFieldsService, useValue: createMockCustomFieldsService() },
        { provide: TechnicianEligibilityRepository, useValue: eligibility },
        { provide: JobFieldSettingsService, useValue: jobFieldSettings },
      ],
    }).compile();

    service = module.get(DealsService);
  });

  // Helper to set up findById mock chain
  function mockFindById(deal = createMockDeal()) {
    cache.get.mockResolvedValue(null);
    repo.findById.mockResolvedValue(deal);
    return deal;
  }

  describe('create', () => {
    const caller = createMockJwtUser({ id: 'dispatcher-1', roleId: 'role-dispatcher' });

    it('422s with the exact fields when admin-required ones are empty', async () => {
      http.validateContact.mockResolvedValue(true);
      jobFieldSettings.missingRequiredForCreate.mockResolvedValue([
        { id: 'source', label: 'Job source' },
      ]);

      await expect(
        service.create(
          {
            contactId: 'contact-1',
            clientType: ClientType.RESIDENTIAL,
            serviceArea: 'Atlanta Metro',
            address: { street: '123 Main', city: 'Atlanta', state: 'GA', zip: '30301' },
            jobTypeId: 'jobtype-1',
          } as never,
          caller,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          missingFields: [{ id: 'source', name: 'Job source' }],
        }),
      });
      expect(repo.create).not.toHaveBeenCalled();
    });
    const dto = {
      contactId: 'contact-1',
      clientType: ClientType.RESIDENTIAL,
      serviceArea: 'Atlanta Metro',
      address: { street: '123 Main', city: 'Atlanta', state: 'GA', zip: '30301' },
      jobTypeId: 'jobtype-1',
    };

    it('stores the external company on create and rejects a disabled one', async () => {
      repo.reserveDealNumber.mockResolvedValue('K4T9ZW');
      repo.create.mockResolvedValue(undefined);

      const result = await service.create(
        { ...dto, externalCompanyId: 'extco-1' } as any,
        caller,
      );
      expect(result.externalCompanyId).toBe('extco-1');
      expect(externalCompanies.findById).toHaveBeenCalledWith('extco-1');

      externalCompanies.findById.mockResolvedValue(
        createMockExternalCompany({ active: false, name: 'Agero' }),
      );
      await expect(
        service.create({ ...dto, externalCompanyId: 'extco-2' } as any, caller),
      ).rejects.toThrow(/disabled/i);
    });

    it('should create deal with auto-generated fields', async () => {
      repo.reserveDealNumber.mockResolvedValue('K4T9ZW');
      repo.create.mockResolvedValue(undefined);

      const result = await service.create(dto as any, caller);

      expect(result.id).toBeDefined();
      expect(result.dealNumber).toBe('K4T9ZW');
      expect(result.superStatus).toBe(JobSuperStatus.SUBMITTED);
      expect(result.status).toBe(DealStatus.ACTIVE);
      expect(result.assignedDispatcherId).toBe('dispatcher-1');
      expect(result.priority).toBe(DealPriority.NORMAL);
      expect(result.tagIds).toEqual([]);
      expect(repo.create).toHaveBeenCalled();
    });

    it('persists a platinum work-order link and PO number', async () => {
      repo.reserveDealNumber.mockResolvedValue('K4T9ZW');
      repo.create.mockResolvedValue(undefined);

      const result = await service.create(
        { ...dto, workOrderId: 'wo-1', poNumber: 'PO-12345' } as any,
        caller,
      );

      expect(result.workOrderId).toBe('wo-1');
      expect(result.poNumber).toBe('PO-12345');
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ workOrderId: 'wo-1', poNumber: 'PO-12345' }),
      );
    });

    it('auto-resolves serviceAreaId and label from the geocoded address', async () => {
      repo.reserveDealNumber.mockResolvedValue('K4T9ZW');
      repo.create.mockResolvedValue(undefined);
      serviceAreas.resolvePoint.mockResolvedValue({ id: 'area-9', name: 'North Metro' });

      const result = await service.create(dto as any, caller);

      expect(serviceAreas.resolvePoint).toHaveBeenCalledWith({ lat: 33.749, lng: -84.388 });
      expect(result.serviceAreaId).toBe('area-9');
      expect(result.serviceArea).toBe('North Metro');
    });

    it('falls back to the provided label when no area covers the address', async () => {
      repo.reserveDealNumber.mockResolvedValue('K4T9ZW');
      repo.create.mockResolvedValue(undefined);
      serviceAreas.resolvePoint.mockResolvedValue(null);

      const result = await service.create(dto as any, caller);

      expect(result.serviceAreaId).toBeUndefined();
      expect(result.serviceArea).toBe('Atlanta Metro');
    });

    it('should use provided priority and tags', async () => {
      repo.reserveDealNumber.mockResolvedValue('X7B2QP');
      repo.create.mockResolvedValue(undefined);
      jobTags.list.mockResolvedValue([createMockJobTag({ id: 'tag-vip', active: true })]);

      const result = await service.create(
        { ...dto, priority: DealPriority.URGENT, tagIds: ['tag-vip'] } as any,
        caller,
      );

      expect(result.priority).toBe(DealPriority.URGENT);
      expect(result.tagIds).toEqual(['tag-vip']);
    });

    it('should validate contact exists', async () => {
      http.validateContact.mockResolvedValue(false);
      await expect(service.create(dto as any, caller)).rejects.toThrow(BadRequestException);
    });

    it('should add CREATED timeline entry', async () => {
      repo.reserveDealNumber.mockResolvedValue('K4T9ZW');
      repo.create.mockResolvedValue(undefined);

      await service.create(dto as any, caller);

      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: TimelineEventType.CREATED }),
      );
    });

    it('should publish deal.created event', async () => {
      repo.reserveDealNumber.mockResolvedValue('K4T9ZW');
      repo.create.mockResolvedValue(undefined);

      await service.create(dto as any, caller);

      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'deal.created', expect.any(Object));
    });
  });

  describe('findById', () => {
    it('should return cached deal on hit', async () => {
      const deal = createMockDeal();
      cache.get.mockResolvedValue(deal);

      const result = await service.findById('deal-1');

      expect(result).toEqual(deal);
      expect(repo.findById).not.toHaveBeenCalled();
    });

    it('should fetch from repo and cache on miss', async () => {
      const deal = createMockDeal();
      cache.get.mockResolvedValue(null);
      repo.findById.mockResolvedValue(deal);

      const result = await service.findById('deal-1');

      expect(result).toBeDefined();
      expect(repo.findById).toHaveBeenCalledWith('deal-1');
      expect(cache.set).toHaveBeenCalled();
    });

    it('should throw NotFoundException when not found', async () => {
      cache.get.mockResolvedValue(null);
      repo.findById.mockResolvedValue(null);

      await expect(service.findById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    const caller = createMockJwtUser({ id: 'user-1' });
    const mockResult = { items: [createMockDeal()], nextCursor: undefined };

    it('should query by super-status when provided', async () => {
      repo.findBySuperStatus.mockResolvedValue(mockResult);
      await service.list({ superStatus: JobSuperStatus.SUBMITTED } as any, caller);
      expect(repo.findBySuperStatus).toHaveBeenCalledWith(JobSuperStatus.SUBMITTED, 20, undefined, expect.any(Object));
    });

    it('should query by techId when provided', async () => {
      repo.findByTech.mockResolvedValue(mockResult);
      await service.list({ techId: 'tech-1' } as any, caller);
      expect(repo.findByTech).toHaveBeenCalledWith('tech-1', 20, undefined, expect.any(Object));
    });

    it('should query by dispatcherId when provided', async () => {
      repo.findByDispatcher.mockResolvedValue(mockResult);
      await service.list({ dispatcherId: 'disp-1' } as any, caller);
      expect(repo.findByDispatcher).toHaveBeenCalledWith('disp-1', 20, undefined, expect.any(Object));
    });

    it('should query by contactId when provided', async () => {
      repo.findByContact.mockResolvedValue(mockResult);
      await service.list({ contactId: 'contact-1' } as any, caller);
      expect(repo.findByContact).toHaveBeenCalledWith('contact-1', 20, undefined, expect.any(Object));
    });

    it('should fall back to findAll when no specific filter', async () => {
      repo.findAll.mockResolvedValue(mockResult);
      await service.list({} as any, caller);
      expect(repo.findAll).toHaveBeenCalledWith(20, undefined, expect.objectContaining({ status: undefined }));
    });

    it('should enforce assigned_only data scope', async () => {
      repo.findByTech.mockResolvedValue(mockResult);
      await service.list({} as any, caller, 'assigned_only');
      expect(repo.findByTech).toHaveBeenCalledWith('user-1', 20, undefined, expect.any(Object));
    });

    it('should not override existing techId with assigned_only', async () => {
      repo.findByTech.mockResolvedValue(mockResult);
      await service.list({ techId: 'other-tech' } as any, caller, 'assigned_only');
      expect(repo.findByTech).toHaveBeenCalledWith('other-tech', 20, undefined, expect.any(Object));
    });

    it('should use custom limit', async () => {
      repo.findAll.mockResolvedValue(mockResult);
      await service.list({ limit: 50 } as any, caller);
      expect(repo.findAll).toHaveBeenCalledWith(50, undefined, expect.objectContaining({ status: undefined }));
    });

    it('should coerce a string limit (raw query param) to a number', async () => {
      repo.findAll.mockResolvedValue(mockResult);
      // Without a ValidationPipe transform, limit arrives as a string; a string
      // Limit makes DynamoDB throw SerializationException.
      await service.list({ limit: '100' } as any, caller);
      expect(repo.findAll).toHaveBeenCalledWith(100, undefined, expect.any(Object));
    });

    it('should clamp an out-of-range limit into 1..100', async () => {
      repo.findAll.mockResolvedValue(mockResult);
      await service.list({ limit: '9999' } as any, caller);
      expect(repo.findAll).toHaveBeenCalledWith(100, undefined, expect.any(Object));
    });

    it('should pass secondary filters (jobTypeId, priority) through', async () => {
      repo.findAll.mockResolvedValue(mockResult);
      await service.list({ jobTypeId: 'jobtype-1', priority: 'urgent' } as any, caller);
      expect(repo.findAll).toHaveBeenCalledWith(
        20,
        undefined,
        expect.objectContaining({ jobTypeId: 'jobtype-1', priority: 'urgent' }),
      );
    });

    it('should split comma-separated tag ids into an array', async () => {
      repo.findBySuperStatus.mockResolvedValue(mockResult);
      await service.list({ superStatus: JobSuperStatus.SUBMITTED, tagIds: 'tag-1, tag-2' } as any, caller);
      expect(repo.findBySuperStatus).toHaveBeenCalledWith(
        JobSuperStatus.SUBMITTED,
        20,
        undefined,
        expect.objectContaining({ tagIds: ['tag-1', 'tag-2'] }),
      );
    });

    it('should parse a "#1042" search into a legacy numeric dealNumber filter', async () => {
      repo.findAll.mockResolvedValue(mockResult);
      await service.list({ search: '#1042' } as any, caller);
      expect(repo.findAll).toHaveBeenCalledWith(
        20,
        undefined,
        expect.objectContaining({ dealNumber: 1042 }),
      );
    });

    it('should parse a "#K4T9ZW" search into a code dealNumber filter', async () => {
      repo.findAll.mockResolvedValue(mockResult);
      await service.list({ search: '#K4T9ZW' } as any, caller);
      expect(repo.findAll).toHaveBeenCalledWith(
        20,
        undefined,
        expect.objectContaining({ dealNumber: 'K4T9ZW' }),
      );
    });

    it('should uppercase a bare lowercase code search', async () => {
      repo.findAll.mockResolvedValue(mockResult);
      await service.list({ search: 'k4t9zw' } as any, caller);
      expect(repo.findAll).toHaveBeenCalledWith(
        20,
        undefined,
        expect.objectContaining({ dealNumber: 'K4T9ZW' }),
      );
    });

    it('should NOT treat a pure-letter word as a dealNumber filter', async () => {
      repo.findAll.mockResolvedValue(mockResult);
      await service.list({ search: 'SMITHS' } as any, caller);
      expect(repo.findAll).toHaveBeenCalledWith(
        20,
        undefined,
        expect.objectContaining({ dealNumber: undefined }),
      );
    });

    it('should pass cursor', async () => {
      repo.findAll.mockResolvedValue(mockResult);
      await service.list({ cursor: 'abc123' } as any, caller);
      expect(repo.findAll).toHaveBeenCalledWith(20, 'abc123', expect.objectContaining({ status: undefined }));
    });
  });

  describe('update', () => {
    const caller = createMockJwtUser({ id: 'dispatcher-1' });

    it('should update deal and add timeline entries', async () => {
      const deal = mockFindById();
      repo.update.mockResolvedValue({ ...deal, notes: 'Updated' });

      await service.update('deal-1', { notes: 'Updated' } as any, caller);

      expect(repo.update).toHaveBeenCalledWith('deal-1', { notes: 'Updated' });
      expect(cache.invalidate).toHaveBeenCalledWith('deal-1');
      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: TimelineEventType.FIELD_UPDATED }),
      );
    });

    it('clears the external company when the patch sends null', async () => {
      const deal = mockFindById();
      repo.update.mockResolvedValue({ ...deal });

      await service.update('deal-1', { externalCompanyId: null } as any, caller);

      // null reaches the repository (which REMOVEs the attribute); no lookup
      // of a non-existent "null" company.
      expect(repo.update).toHaveBeenCalledWith('deal-1', { externalCompanyId: null });
      expect(externalCompanies.findById).not.toHaveBeenCalled();
    });

    it('validates the external company when it changes on update', async () => {
      const deal = mockFindById();
      repo.update.mockResolvedValue({ ...deal, externalCompanyId: 'extco-1' });

      await service.update('deal-1', { externalCompanyId: 'extco-1' } as any, caller);

      expect(externalCompanies.findById).toHaveBeenCalledWith('extco-1');
      expect(repo.update).toHaveBeenCalledWith('deal-1', { externalCompanyId: 'extco-1' });
    });

    it("stores a per-job client-name override ('Just here') and clears it with null", async () => {
      const deal = mockFindById();
      repo.update.mockResolvedValue({ ...deal });

      await service.update(
        'deal-1',
        { clientName: { firstName: 'Janet', lastName: 'Poole' } } as any,
        caller,
      );
      expect(repo.update).toHaveBeenCalledWith('deal-1', {
        clientName: { firstName: 'Janet', lastName: 'Poole' },
      });

      mockFindById();
      await service.update('deal-1', { clientName: null } as any, caller);
      expect(repo.update).toHaveBeenCalledWith('deal-1', { clientName: null });
    });

    it('publishes deal.updated so the search index refreshes on any edit', async () => {
      const deal = mockFindById();
      repo.update.mockResolvedValue({ ...deal, notes: 'Updated' });

      await service.update('deal-1', { notes: 'Updated' } as any, caller);

      expect(sns.publish).toHaveBeenCalledWith(
        'deal-events',
        'deal.updated',
        expect.objectContaining({ dealId: 'deal-1' }),
      );
    });

    it('records oldValue and newValue for a changed field', async () => {
      const deal = mockFindById(createMockDeal({ priority: DealPriority.NORMAL }));
      repo.update.mockResolvedValue({ ...deal, priority: DealPriority.URGENT });

      await service.update('deal-1', { priority: DealPriority.URGENT } as any, caller);

      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: TimelineEventType.FIELD_UPDATED,
          details: { field: 'priority', oldValue: DealPriority.NORMAL, newValue: DealPriority.URGENT },
        }),
      );
    });

    it('records null as oldValue when the field was previously unset', async () => {
      const deal = mockFindById(createMockDeal({ poNumber: undefined }));
      repo.update.mockResolvedValue({ ...deal, poNumber: 'PO-77' });

      await service.update('deal-1', { poNumber: 'PO-77' } as any, caller);

      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          details: { field: 'poNumber', oldValue: null, newValue: 'PO-77' },
        }),
      );
    });

    it('does not log a field whose value did not change', async () => {
      const deal = mockFindById(createMockDeal({ priority: DealPriority.NORMAL }));
      repo.update.mockResolvedValue(deal);

      await service.update('deal-1', { priority: DealPriority.NORMAL } as any, caller);

      expect(timeline.addEntry).not.toHaveBeenCalled();
    });

    it('does not log a deep-equal unchanged array', async () => {
      const deal = mockFindById(createMockDeal({ tagIds: ['tag-1'] }));
      jobTags.list.mockResolvedValue([createMockJobTag({ id: 'tag-1' })]);
      repo.update.mockResolvedValue(deal);

      await service.update('deal-1', { tagIds: ['tag-1'] } as any, caller);

      expect(timeline.addEntry).not.toHaveBeenCalled();
    });

    it('logs an address change with the old and new address', async () => {
      const deal = mockFindById();
      repo.update.mockResolvedValue(deal);

      await service.update(
        'deal-1',
        { address: { street: '456 Oak', city: 'Marietta', state: 'GA', zip: '30060' } } as any,
        caller,
      );

      expect(timeline.addEntry).toHaveBeenCalledTimes(1);
      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({
            field: 'address',
            oldValue: expect.objectContaining({ street: '123 Main St' }),
            newValue: expect.objectContaining({ street: '456 Oak' }),
          }),
        }),
      );
    });

    it('should convert address class instance to plain object', async () => {
      const deal = mockFindById();
      repo.update.mockResolvedValue(deal);

      const addressDto = { street: '456 Oak', city: 'Marietta', state: 'GA', zip: '30060' };
      await service.update('deal-1', { address: addressDto } as any, caller);

      const updateCall = repo.update.mock.calls[0][1];
      expect(updateCall.address).not.toBe(addressDto); // should be a copy
      expect(updateCall.address).toMatchObject(addressDto);
      // A new address is geocoded on the way through — see deals.service.geo.spec.
      expect(updateCall.address.lat).toEqual(expect.any(Number));
      expect(updateCall.address.lng).toEqual(expect.any(Number));
    });

    it('should skip undefined values in timeline tracking', async () => {
      const deal = mockFindById();
      repo.update.mockResolvedValue(deal);

      await service.update('deal-1', {} as any, caller);

      expect(timeline.addEntry).not.toHaveBeenCalled();
    });
  });

  describe('softDelete', () => {
    const caller = createMockJwtUser({ id: 'admin-1' });

    it('should soft delete and invalidate cache', async () => {
      mockFindById();
      await service.softDelete('deal-1', caller);
      expect(repo.softDelete).toHaveBeenCalledWith('deal-1');
      expect(cache.invalidate).toHaveBeenCalledWith('deal-1');
    });

    it('publishes deal.deleted so the doc leaves the search index', async () => {
      mockFindById();
      await service.softDelete('deal-1', caller);
      expect(sns.publish).toHaveBeenCalledWith(
        'deal-events',
        'deal.deleted',
        expect.objectContaining({ dealId: 'deal-1' }),
      );
    });
  });

  describe('moveStatus', () => {
    const caller = createMockJwtUser({ id: 'admin-1', roleId: 'role-admin' });

    it('should move super-status and add a STATUS_CHANGED timeline entry', async () => {
      const deal = mockFindById(createMockDeal({ superStatus: JobSuperStatus.SUBMITTED }));
      repo.update.mockResolvedValue({ ...deal, superStatus: JobSuperStatus.IN_PROGRESS });

      await service.moveStatus('deal-1', { superStatus: JobSuperStatus.IN_PROGRESS }, caller);

      expect(repo.update).toHaveBeenCalledWith('deal-1', expect.objectContaining({ superStatus: JobSuperStatus.IN_PROGRESS }));
      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: TimelineEventType.STATUS_CHANGED,
          details: expect.objectContaining({ fromStatus: JobSuperStatus.SUBMITTED, toStatus: JobSuperStatus.IN_PROGRESS }),
        }),
      );
      expect(cache.invalidate).toHaveBeenCalledWith('deal-1');
    });

    it('should publish deal.status_changed event', async () => {
      const deal = mockFindById(createMockDeal({ superStatus: JobSuperStatus.SUBMITTED }));
      repo.update.mockResolvedValue({ ...deal, superStatus: JobSuperStatus.IN_PROGRESS });

      await service.moveStatus('deal-1', { superStatus: JobSuperStatus.IN_PROGRESS }, caller);

      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'deal.status_changed', expect.objectContaining({
        dealId: 'deal-1', oldStatus: JobSuperStatus.SUBMITTED, newStatus: JobSuperStatus.IN_PROGRESS,
      }));
    });

    it('should require cancellationReason when moving to canceled', async () => {
      mockFindById(createMockDeal({ superStatus: JobSuperStatus.SUBMITTED }));
      await expect(
        service.moveStatus('deal-1', { superStatus: JobSuperStatus.CANCELED }, caller),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow canceled with a reason', async () => {
      const deal = mockFindById(createMockDeal({ superStatus: JobSuperStatus.SUBMITTED }));
      repo.update.mockResolvedValue({ ...deal, superStatus: JobSuperStatus.CANCELED });

      await service.moveStatus(
        'deal-1', { superStatus: JobSuperStatus.CANCELED, cancellationReason: 'Client resolved' }, caller,
      );

      expect(repo.update).toHaveBeenCalledWith('deal-1', expect.objectContaining({
        superStatus: JobSuperStatus.CANCELED, cancellationReason: 'Client resolved',
      }));
    });

    it('uses the Canceled sub-status name as the cancellation reason', async () => {
      const deal = mockFindById(createMockDeal({ superStatus: JobSuperStatus.SUBMITTED }));
      repo.update.mockResolvedValue({ ...deal, superStatus: JobSuperStatus.CANCELED });
      jobStatuses.findById.mockResolvedValue({
        id: 'ss-high-price',
        name: 'High Price',
        group: JobSuperStatus.CANCELED,
        color: 'red',
        priority: 0,
        active: true,
      });

      await service.moveStatus(
        'deal-1',
        { superStatus: JobSuperStatus.CANCELED, subStatusId: 'ss-high-price' },
        caller,
      );

      expect(repo.update).toHaveBeenCalledWith('deal-1', expect.objectContaining({
        superStatus: JobSuperStatus.CANCELED,
        subStatusId: 'ss-high-price',
        cancellationReason: 'High Price',
      }));
    });

    it('stamps closedAt when moving to Done or Canceled', async () => {
      const deal = mockFindById(createMockDeal({ superStatus: JobSuperStatus.SUBMITTED }));
      repo.update.mockResolvedValue({ ...deal, superStatus: JobSuperStatus.DONE });

      await service.moveStatus('deal-1', { superStatus: JobSuperStatus.DONE }, caller);

      const patch = repo.update.mock.calls.at(-1)![1];
      expect(typeof patch.closedAt).toBe('string');
      expect(Number.isNaN(Date.parse(patch.closedAt))).toBe(false);
    });

    it('stamps closedAt via a Canceled sub-status too', async () => {
      const deal = mockFindById(createMockDeal({ superStatus: JobSuperStatus.SUBMITTED }));
      repo.update.mockResolvedValue({ ...deal, superStatus: JobSuperStatus.CANCELED });
      jobStatuses.findById.mockResolvedValue({
        id: 'ss-high-price', name: 'High Price', group: JobSuperStatus.CANCELED,
        color: 'red', priority: 0, active: true,
      });

      await service.moveStatus('deal-1', { superStatus: JobSuperStatus.CANCELED, subStatusId: 'ss-high-price' }, caller);

      expect(repo.update.mock.calls.at(-1)![1].closedAt).toEqual(expect.any(String));
    });

    it('does not stamp closedAt for done_pending_approval — only Done/Canceled close', async () => {
      const deal = mockFindById(createMockDeal({ superStatus: JobSuperStatus.SUBMITTED }));
      repo.update.mockResolvedValue({ ...deal, superStatus: JobSuperStatus.DONE_PENDING_APPROVAL });

      await service.moveStatus('deal-1', { superStatus: JobSuperStatus.DONE_PENDING_APPROVAL }, caller);

      expect('closedAt' in repo.update.mock.calls.at(-1)![1]).toBe(false);
    });

    it('clears closedAt when reopening a closed job', async () => {
      const deal = mockFindById(createMockDeal({ superStatus: JobSuperStatus.DONE, closedAt: '2026-08-01T00:00:00.000Z' }));
      repo.update.mockResolvedValue({ ...deal, superStatus: JobSuperStatus.IN_PROGRESS });

      await service.moveStatus('deal-1', { superStatus: JobSuperStatus.IN_PROGRESS }, caller);

      expect(repo.update.mock.calls.at(-1)![1].closedAt).toBeNull();
    });

    it('should set a sub-status that belongs to the target super-status', async () => {
      const deal = mockFindById(createMockDeal({ superStatus: JobSuperStatus.SUBMITTED }));
      jobStatuses.findById.mockResolvedValue({ id: 'sub-1', name: 'Job Done', group: JobSuperStatus.IN_PROGRESS });
      repo.update.mockResolvedValue({ ...deal, superStatus: JobSuperStatus.IN_PROGRESS, subStatusId: 'sub-1' });

      await service.moveStatus('deal-1', { superStatus: JobSuperStatus.IN_PROGRESS, subStatusId: 'sub-1' }, caller);

      expect(repo.update).toHaveBeenCalledWith('deal-1', expect.objectContaining({
        superStatus: JobSuperStatus.IN_PROGRESS, subStatusId: 'sub-1',
      }));
    });

    it('should reject a sub-status that belongs to a different super-status', async () => {
      mockFindById(createMockDeal({ superStatus: JobSuperStatus.SUBMITTED }));
      jobStatuses.findById.mockResolvedValue({ id: 'sub-1', name: 'Will Call Back', group: JobSuperStatus.PENDING });

      await expect(
        service.moveStatus('deal-1', { superStatus: JobSuperStatus.IN_PROGRESS, subStatusId: 'sub-1' }, caller),
      ).rejects.toThrow(BadRequestException);
    });

    it('records the previous and next sub-status on the timeline entry', async () => {
      const deal = mockFindById(createMockDeal({ superStatus: JobSuperStatus.IN_PROGRESS, subStatusId: 'old-sub' }));
      jobStatuses.findById.mockResolvedValue({ id: 'sub-2', name: 'Parts Ordered', group: JobSuperStatus.PENDING });
      repo.update.mockResolvedValue({ ...deal, superStatus: JobSuperStatus.PENDING, subStatusId: 'sub-2' });

      await service.moveStatus('deal-1', { superStatus: JobSuperStatus.PENDING, subStatusId: 'sub-2' }, caller);

      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: TimelineEventType.STATUS_CHANGED,
          details: expect.objectContaining({ fromSubStatusId: 'old-sub', subStatusId: 'sub-2' }),
        }),
      );
    });

    it('records a null fromSubStatusId when the deal had no sub-status', async () => {
      const deal = mockFindById(createMockDeal({ superStatus: JobSuperStatus.SUBMITTED }));
      repo.update.mockResolvedValue({ ...deal, superStatus: JobSuperStatus.IN_PROGRESS });

      await service.moveStatus('deal-1', { superStatus: JobSuperStatus.IN_PROGRESS }, caller);

      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({ fromSubStatusId: null, subStatusId: null }),
        }),
      );
    });

    it('should clear the sub-status when none is provided', async () => {
      const deal = mockFindById(createMockDeal({ superStatus: JobSuperStatus.IN_PROGRESS, subStatusId: 'old-sub' }));
      repo.update.mockResolvedValue({ ...deal, superStatus: JobSuperStatus.PENDING });

      await service.moveStatus('deal-1', { superStatus: JobSuperStatus.PENDING }, caller);

      // null (not undefined) so the repository REMOVEs the stale sub-status —
      // undefined is skipped by update(), leaving the old sub-status attached.
      expect(repo.update).toHaveBeenCalledWith('deal-1', expect.objectContaining({
        superStatus: JobSuperStatus.PENDING, subStatusId: null,
      }));
    });

    it('should publish deal.completed when moving to Done', async () => {
      const deal = mockFindById(createMockDeal({ superStatus: JobSuperStatus.PENDING }));
      repo.update.mockResolvedValue({ ...deal, superStatus: JobSuperStatus.DONE });

      await service.moveStatus('deal-1', { superStatus: JobSuperStatus.DONE }, caller);

      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'deal.completed', expect.any(Object));
    });

    it('should not publish deal.completed for a non-Done move', async () => {
      const deal = mockFindById(createMockDeal({ superStatus: JobSuperStatus.SUBMITTED }));
      repo.update.mockResolvedValue({ ...deal, superStatus: JobSuperStatus.IN_PROGRESS });

      await service.moveStatus('deal-1', { superStatus: JobSuperStatus.IN_PROGRESS }, caller);

      expect(sns.publish).not.toHaveBeenCalledWith('deal-events', 'deal.completed', expect.any(Object));
    });
  });

  describe('getTimeline', () => {
    it('should return paginated timeline', async () => {
      mockFindById();
      const mockTimeline = { items: [], nextCursor: undefined };
      timeline.findByDeal.mockResolvedValue(mockTimeline);

      const result = await service.getTimeline('deal-1', 10, 'cursor');

      expect(timeline.findByDeal).toHaveBeenCalledWith('deal-1', 10, 'cursor');
      expect(result).toEqual(mockTimeline);
    });

    it('should use default limit of 20', async () => {
      mockFindById();
      timeline.findByDeal.mockResolvedValue({ items: [], nextCursor: undefined });

      await service.getTimeline('deal-1');

      expect(timeline.findByDeal).toHaveBeenCalledWith('deal-1', 20, undefined);
    });
  });

  describe('addNote', () => {
    const caller = createMockJwtUser({ id: 'dispatcher-1' });

    it('should add NOTE_ADDED timeline entry', async () => {
      mockFindById();
      await service.addNote('deal-1', { note: 'Test note' } as any, caller);

      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: TimelineEventType.NOTE_ADDED, note: 'Test note' }),
      );
    });
  });

  describe('getQualifiedTechs', () => {
    // A deal for jobtype X in area Y; techs are matched against the local
    // eligibility projection by these ids.
    const dealForMatch = () =>
      createMockDeal({
        jobTypeId: 'jt-x',
        serviceAreaId: 'sa-y',
        address: createMockAddress({ lat: 33.749, lng: -84.388 }),
      });

    const projected = (over: Record<string, unknown>) => ({
      technicianId: 't',
      jobTypeIds: ['jt-x'],
      serviceAreaIds: ['sa-y'],
      assignable: true,
      updatedAt: '2026-04-16T10:00:00.000Z',
      ...over,
    });

    it('flags a tech approved for the deal’s job type and area as eligible', async () => {
      mockFindById(dealForMatch());
      eligibility.listAll.mockResolvedValue([
        projected({ technicianId: 't-1', homeAddress: { lat: 33.953, lng: -84.55 } }),
      ]);

      const result = await service.getQualifiedTechs('deal-1');

      expect(result[0]).toMatchObject({ id: 't-1', eligible: true, reasons: [] });
      expect(typeof result[0].distanceMiles).toBe('number');
    });

    it('flags a tech missing the job type as ineligible with a reason', async () => {
      mockFindById(dealForMatch());
      eligibility.listAll.mockResolvedValue([
        projected({ technicianId: 't-2', jobTypeIds: ['jt-other'] }),
      ]);

      const result = await service.getQualifiedTechs('deal-1');

      expect(result[0]).toMatchObject({ id: 't-2', eligible: false });
      expect(result[0].reasons).toContain('missing_job_type');
    });

    it('flags a tech outside the deal’s area as ineligible', async () => {
      mockFindById(dealForMatch());
      eligibility.listAll.mockResolvedValue([
        projected({ technicianId: 't-3', serviceAreaIds: ['sa-other'] }),
      ]);

      const result = await service.getQualifiedTechs('deal-1');
      expect(result[0].reasons).toContain('outside_area');
    });

    it('ranks eligible techs first, then by ascending distance', async () => {
      mockFindById(dealForMatch());
      eligibility.listAll.mockResolvedValue([
        projected({ technicianId: 'far', homeAddress: { lat: 34.3, lng: -84.9 } }),
        projected({ technicianId: 'ineligible', jobTypeIds: ['jt-other'] }),
        projected({ technicianId: 'near', homeAddress: { lat: 33.8, lng: -84.4 } }),
      ]);

      const result = await service.getQualifiedTechs('deal-1');

      expect(result.map((t) => t.id)).toEqual(['near', 'far', 'ineligible']);
    });

    it('returns null distance when the tech has no coordinates', async () => {
      mockFindById(dealForMatch());
      eligibility.listAll.mockResolvedValue([projected({ technicianId: 't-1' })]);

      const result = await service.getQualifiedTechs('deal-1');
      expect(result[0].distanceMiles).toBeNull();
    });
  });

  describe('rankQualifiedTechsFor — before a deal exists (New Job)', () => {
    it('ranks techs against a job type + area with no deal, distance from a point', async () => {
      eligibility.listAll.mockResolvedValue([
        {
          technicianId: 't-fit',
          jobTypeIds: ['jt-x'],
          serviceAreaIds: ['sa-y'],
          assignable: true,
          homeAddress: { lat: 33.95, lng: -84.55 },
          updatedAt: '2026-04-16T10:00:00.000Z',
        },
        {
          technicianId: 't-wrong-type',
          jobTypeIds: ['jt-other'],
          serviceAreaIds: ['sa-y'],
          assignable: true,
          updatedAt: '2026-04-16T10:00:00.000Z',
        },
      ]);

      const result = await service.rankQualifiedTechsFor({
        jobTypeId: 'jt-x',
        serviceAreaId: 'sa-y',
        lat: 33.749,
        lng: -84.388,
      });

      const fit = result.find((r) => r.id === 't-fit')!;
      const wrong = result.find((r) => r.id === 't-wrong-type')!;
      expect(fit.eligible).toBe(true);
      expect(typeof fit.distanceMiles).toBe('number');
      expect(wrong.eligible).toBe(false);
      expect(wrong.reasons).toContain('missing_job_type');
    });

    it('treats an empty job type as "any" — no missing_job_type reason', async () => {
      eligibility.listAll.mockResolvedValue([
        {
          technicianId: 't-any',
          jobTypeIds: ['jt-other'],
          serviceAreaIds: ['sa-y'],
          assignable: true,
          updatedAt: '2026-04-16T10:00:00.000Z',
        },
      ]);

      const result = await service.rankQualifiedTechsFor({ jobTypeId: '', serviceAreaId: 'sa-y' });
      expect(result[0].eligible).toBe(true);
      expect(result[0].reasons).not.toContain('missing_job_type');
    });

    it('marks everyone outside_area when no service area is given', async () => {
      eligibility.listAll.mockResolvedValue([
        {
          technicianId: 't-1',
          jobTypeIds: ['jt-x'],
          serviceAreaIds: ['sa-y'],
          assignable: true,
          updatedAt: '2026-04-16T10:00:00.000Z',
        },
      ]);

      const result = await service.rankQualifiedTechsFor({ jobTypeId: 'jt-x' });
      expect(result[0].eligible).toBe(false);
      expect(result[0].reasons).toContain('outside_area');
    });
  });

  describe('assignTechs', () => {
    const caller = createMockJwtUser({ id: 'dispatcher-1', roleId: 'role-dispatcher' });

    it('adds assignment rows, sets the roster, and emits per-tech events', async () => {
      const deal = mockFindById(createMockDeal({ stage: DealStage.NEW_LEAD, assignedTechIds: [] }));
      repo.update.mockResolvedValue({ ...deal, assignedTechIds: ['tech-1', 'tech-2'], stage: DealStage.ASSIGNED });

      await service.assignTechs('deal-1', ['tech-1', 'tech-2'], caller);

      expect(repo.addAssignment).toHaveBeenCalledWith('deal-1', 'tech-1', expect.anything(), 'dispatcher-1');
      expect(repo.addAssignment).toHaveBeenCalledWith('deal-1', 'tech-2', expect.anything(), 'dispatcher-1');
      expect(repo.update).toHaveBeenCalledWith('deal-1', expect.objectContaining({ assignedTechIds: ['tech-1', 'tech-2'] }));
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'deal.tech_assigned', expect.objectContaining({ techId: 'tech-1' }));
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'deal.tech_assigned', expect.objectContaining({ techId: 'tech-2' }));
    });

    it('auto-transitions to In Progress on the first assignment', async () => {
      const deal = mockFindById(createMockDeal({ superStatus: JobSuperStatus.SUBMITTED, assignedTechIds: [] }));
      repo.update.mockResolvedValue(deal);

      await service.assignTechs('deal-1', ['tech-1'], caller);

      expect(repo.update).toHaveBeenCalledWith('deal-1', expect.objectContaining({ superStatus: JobSuperStatus.IN_PROGRESS }));
    });

    it('does not re-transition when techs are already assigned', async () => {
      const deal = mockFindById(createMockDeal({ superStatus: JobSuperStatus.IN_PROGRESS, assignedTechIds: ['tech-1'] }));
      repo.update.mockResolvedValue(deal);

      await service.assignTechs('deal-1', ['tech-1', 'tech-2'], caller);

      const updateArg = repo.update.mock.calls[0][1];
      expect(updateArg.stage).toBeUndefined();
    });

    it('removes a dropped tech and emits an unassigned event', async () => {
      const deal = mockFindById(createMockDeal({ stage: DealStage.ASSIGNED, assignedTechIds: ['tech-1', 'tech-2'] }));
      repo.update.mockResolvedValue(deal);

      await service.assignTechs('deal-1', ['tech-1'], caller);

      expect(repo.removeAssignment).toHaveBeenCalledWith('deal-1', 'tech-2');
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'deal.tech_unassigned', expect.objectContaining({ techId: 'tech-2' }));
    });
  });

  describe('unassignTech', () => {
    const caller = createMockJwtUser({ id: 'dispatcher-1' });

    it('removes the tech from the roster and publishes the event', async () => {
      const deal = mockFindById(createMockDeal({ assignedTechIds: ['tech-1', 'tech-2'], stage: DealStage.ASSIGNED }));
      repo.update.mockResolvedValue(deal);

      await service.unassignTech('deal-1', 'tech-1', caller);

      expect(repo.removeAssignment).toHaveBeenCalledWith('deal-1', 'tech-1');
      expect(repo.update).toHaveBeenCalledWith('deal-1', expect.objectContaining({ assignedTechIds: ['tech-2'] }));
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'deal.tech_unassigned', expect.objectContaining({ techId: 'tech-1' }));
    });

    it('throws if the tech is not assigned', async () => {
      mockFindById(createMockDeal({ assignedTechIds: ['tech-2'] }));
      await expect(service.unassignTech('deal-1', 'tech-1', caller)).rejects.toThrow(BadRequestException);
    });
  });

  describe('addProduct', () => {
    const caller = createMockJwtUser({ id: 'tech-1' });
    const dto = {
      sourceTechId: 'tech-1',
      productId: 'product-1', name: 'Deadbolt', sku: 'KW-001',
      quantity: 1, costCompany: 15, costForTech: 20, priceClient: 45,
    };

    it('deducts from the chosen tech and records the source on the line', async () => {
      mockFindById(createMockDeal({ assignedTechIds: ['tech-1', 'tech-2'], stage: DealStage.WORK_IN_PROGRESS }));

      await service.addProduct('deal-1', dto as any, caller);

      expect(http.deductStock).toHaveBeenCalledWith(expect.objectContaining({ containerId: 'tech-1' }));
      expect(products.addProduct).toHaveBeenCalledWith('deal-1', expect.objectContaining({ productId: 'product-1', sourceTechId: 'tech-1' }));
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'deal.product_added', expect.any(Object));
    });

    it('throws if no tech assigned', async () => {
      mockFindById(createMockDeal({ assignedTechIds: [] }));
      await expect(service.addProduct('deal-1', dto as any, caller)).rejects.toThrow(BadRequestException);
    });

    it('throws if the source tech is not on the deal', async () => {
      mockFindById(createMockDeal({ assignedTechIds: ['tech-2'], stage: DealStage.WORK_IN_PROGRESS }));
      await expect(service.addProduct('deal-1', dto as any, caller)).rejects.toThrow(BadRequestException);
    });

    it('turns an insufficient-stock 4xx into a clear BadRequest naming the product', async () => {
      mockFindById(createMockDeal({ assignedTechIds: ['tech-1'], stage: DealStage.WORK_IN_PROGRESS }));
      http.deductStock.mockRejectedValue(
        new HttpException('Insufficient stock for product product-1', 400),
      );

      const err = await service.addProduct('deal-1', dto as any, caller).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toMatch(/Deadbolt/);
      expect(products.addProduct).not.toHaveBeenCalled();
    });

    it('rejects when the referenced product does not exist in inventory', async () => {
      mockFindById(createMockDeal({ assignedTechIds: ['tech-1'], stage: DealStage.WORK_IN_PROGRESS }));
      http.getProduct.mockResolvedValueOnce(null);

      await expect(service.addProduct('deal-1', dto as any, caller)).rejects.toThrow(BadRequestException);
      expect(products.addProduct).not.toHaveBeenCalled();
    });

    describe('service lines', () => {
      const serviceDto = { ...dto, fulfillment: 'service', sourceTechId: undefined };

      beforeEach(() => {
        http.getProduct.mockResolvedValue({ id: 'product-1', name: 'Rekey', sku: 'SVC-1', type: 'service' });
      });

      it('adds a service line without a tech and without deducting stock', async () => {
        mockFindById(createMockDeal({ assignedTechIds: [], stage: DealStage.WORK_IN_PROGRESS }));

        await service.addProduct('deal-1', serviceDto as any, caller);

        expect(http.deductStock).not.toHaveBeenCalled();
        expect(products.addProduct).toHaveBeenCalledWith(
          'deal-1',
          expect.objectContaining({ fulfillment: 'service' }),
        );
        // A service line records no source technician.
        expect(products.addProduct.mock.calls[0][1].sourceTechId).toBeUndefined();
      });

      it('rejects a service-type product added as a sourced line', async () => {
        mockFindById(createMockDeal({ assignedTechIds: ['tech-1'], stage: DealStage.WORK_IN_PROGRESS }));

        await expect(
          service.addProduct('deal-1', { ...dto, fulfillment: 'sourced' } as any, caller),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('to-order lines', () => {
      const orderDto = { ...dto, fulfillment: 'to_order', sourceTechId: undefined };

      it('adds a to-order line without deducting stock or requiring a tech', async () => {
        mockFindById(createMockDeal({ assignedTechIds: [], stage: DealStage.WORK_IN_PROGRESS }));

        await service.addProduct('deal-1', orderDto as any, caller);

        expect(http.deductStock).not.toHaveBeenCalled();
        expect(products.addProduct).toHaveBeenCalledWith(
          'deal-1',
          expect.objectContaining({ fulfillment: 'to_order' }),
        );
      });

      it('rejects adding a stockable product as a service line', async () => {
        mockFindById(createMockDeal({ assignedTechIds: ['tech-1'], stage: DealStage.WORK_IN_PROGRESS }));

        await expect(
          service.addProduct('deal-1', { ...dto, fulfillment: 'service' } as any, caller),
        ).rejects.toThrow(BadRequestException);
      });
    });
  });

  describe('markProductOrdered', () => {
    const caller = createMockJwtUser({ id: 'tech-1' });

    it('sets orderedAt on a to-order line', async () => {
      products.findProduct.mockResolvedValue(
        createMockDealProduct({ fulfillment: 'to_order' }),
      );

      await service.markProductOrdered('deal-1', 'product-1', true, caller);

      expect(products.setOrderedAt).toHaveBeenCalledWith(
        'deal-1',
        'product-1',
        expect.any(String),
      );
    });

    it('clears orderedAt when ordered=false', async () => {
      products.findProduct.mockResolvedValue(
        createMockDealProduct({ fulfillment: 'to_order' }),
      );

      await service.markProductOrdered('deal-1', 'product-1', false, caller);

      expect(products.setOrderedAt).toHaveBeenCalledWith('deal-1', 'product-1', null);
    });

    it('rejects marking a sourced line as ordered', async () => {
      products.findProduct.mockResolvedValue(
        createMockDealProduct({ fulfillment: 'sourced' }),
      );

      await expect(
        service.markProductOrdered('deal-1', 'product-1', true, caller),
      ).rejects.toThrow(BadRequestException);
      expect(products.setOrderedAt).not.toHaveBeenCalled();
    });
  });

  describe('removeProduct', () => {
    const caller = createMockJwtUser({ id: 'tech-1' });

    it('restores stock to the line’s source tech and removes the product', async () => {
      mockFindById(createMockDeal({ assignedTechIds: ['tech-1', 'tech-2'] }));
      products.findProduct.mockResolvedValue(createMockDealProduct({ sourceTechId: 'tech-2' }));

      await service.removeProduct('deal-1', 'product-1', caller);

      expect(http.restoreStock).toHaveBeenCalledWith(expect.objectContaining({ containerId: 'tech-2' }));
      expect(products.removeProduct).toHaveBeenCalledWith('deal-1', 'product-1');
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'deal.product_removed', expect.any(Object));
    });

    it('falls back to the sole assigned tech for a legacy line with no source', async () => {
      mockFindById(createMockDeal({ assignedTechIds: ['tech-9'] }));
      products.findProduct.mockResolvedValue(createMockDealProduct({ sourceTechId: undefined }));

      await service.removeProduct('deal-1', 'product-1', caller);

      expect(http.restoreStock).toHaveBeenCalledWith(expect.objectContaining({ containerId: 'tech-9' }));
    });

    it('throws if product not found on deal', async () => {
      mockFindById(createMockDeal({ assignedTechIds: ['tech-1'] }));
      products.findProduct.mockResolvedValue(null);

      await expect(service.removeProduct('deal-1', 'nonexistent', caller)).rejects.toThrow(NotFoundException);
    });

    it('does not restore stock when removing a service line', async () => {
      mockFindById(createMockDeal({ assignedTechIds: ['tech-1'] }));
      products.findProduct.mockResolvedValue(
        createMockDealProduct({ fulfillment: 'service', sourceTechId: undefined }),
      );

      await service.removeProduct('deal-1', 'product-1', caller);

      expect(http.restoreStock).not.toHaveBeenCalled();
      expect(products.removeProduct).toHaveBeenCalledWith('deal-1', 'product-1');
    });

    it('does not restore stock when removing a to-order line', async () => {
      mockFindById(createMockDeal({ assignedTechIds: ['tech-1'] }));
      products.findProduct.mockResolvedValue(
        createMockDealProduct({ fulfillment: 'to_order', sourceTechId: undefined }),
      );

      await service.removeProduct('deal-1', 'product-1', caller);

      expect(http.restoreStock).not.toHaveBeenCalled();
    });
  });

  describe('replaceProduct', () => {
    const caller = createMockJwtUser({ id: 'dispatcher-1' });
    // The replacement line — a different catalog product by default.
    const dto = {
      sourceTechId: 'tech-1',
      productId: 'product-2', name: 'Schlage Deadbolt', sku: 'SC-002',
      quantity: 2, costCompany: 18, costForTech: 24, priceClient: 60,
    };

    beforeEach(() => {
      http.getProduct.mockResolvedValue({
        id: 'product-2', name: 'Schlage Deadbolt', sku: 'SC-002', type: 'product',
      });
      // The line being edited exists; the swap target does not (no duplicate).
      products.findProduct.mockImplementation(async (_dealId: string, productId: string) =>
        productId === 'product-1' ? createMockDealProduct({ sourceTechId: 'tech-2' }) : null,
      );
    });

    it('swaps a sourced line: restores the old stock, deducts the new, rewrites the row', async () => {
      mockFindById(createMockDeal({ assignedTechIds: ['tech-1', 'tech-2'] }));

      await service.replaceProduct('deal-1', 'product-1', dto as any, caller);

      // The old line goes back to the tech it was pulled from…
      expect(http.restoreStock).toHaveBeenCalledWith(expect.objectContaining({
        containerId: 'tech-2',
        items: [expect.objectContaining({ productId: 'product-1', quantity: 1 })],
      }));
      // …the replacement is pulled from the chosen tech…
      expect(http.deductStock).toHaveBeenCalledWith(expect.objectContaining({
        containerId: 'tech-1',
        items: [expect.objectContaining({ productId: 'product-2', quantity: 2 })],
      }));
      // …and the row moves to the new product id.
      expect(products.removeProduct).toHaveBeenCalledWith('deal-1', 'product-1');
      expect(products.addProduct).toHaveBeenCalledWith('deal-1', expect.objectContaining({
        productId: 'product-2', sourceTechId: 'tech-1', quantity: 2, priceClient: 60,
      }));
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'deal.product_updated', expect.any(Object));
    });

    it('preserves the original addedBy/addedAt and stamps the editor', async () => {
      mockFindById(createMockDeal({ assignedTechIds: ['tech-1'] }));
      products.findProduct.mockImplementation(async (_d: string, productId: string) =>
        productId === 'product-1'
          ? createMockDealProduct({ sourceTechId: 'tech-1', addedBy: 'tech-9', addedAt: '2026-01-01T00:00:00.000Z' })
          : null,
      );

      await service.replaceProduct('deal-1', 'product-1', dto as any, caller);

      expect(products.addProduct).toHaveBeenCalledWith('deal-1', expect.objectContaining({
        addedBy: 'tech-9', addedAt: '2026-01-01T00:00:00.000Z',
        updatedBy: 'dispatcher-1', updatedAt: expect.any(String),
      }));
    });

    it('edits a sourced line in place: restores before deducting so only the delta must fit', async () => {
      mockFindById(createMockDeal({ assignedTechIds: ['tech-1'] }));
      products.findProduct.mockResolvedValue(
        createMockDealProduct({ sourceTechId: 'tech-1', quantity: 2 }),
      );
      http.getProduct.mockResolvedValue({
        id: 'product-1', name: 'Kwikset Deadbolt', sku: 'KW-DB-001', type: 'product',
      });
      const order: string[] = [];
      http.restoreStock.mockImplementation(async () => { order.push('restore'); });
      http.deductStock.mockImplementation(async () => { order.push('deduct'); });

      await service.replaceProduct(
        'deal-1', 'product-1',
        { ...dto, productId: 'product-1', name: 'Kwikset Deadbolt', sku: 'KW-DB-001', quantity: 3 } as any,
        caller,
      );

      expect(order).toEqual(['restore', 'deduct']);
      // Same product id — the row is overwritten, never deleted.
      expect(products.removeProduct).not.toHaveBeenCalled();
      expect(products.addProduct).toHaveBeenCalledWith('deal-1', expect.objectContaining({
        productId: 'product-1', quantity: 3,
      }));
    });

    it('re-deducts the old line when the new deduction fails, naming the product', async () => {
      mockFindById(createMockDeal({ assignedTechIds: ['tech-1', 'tech-2'] }));
      http.deductStock.mockRejectedValueOnce(new HttpException('Insufficient stock', 400));

      const err = await service.replaceProduct('deal-1', 'product-1', dto as any, caller).catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toMatch(/Schlage Deadbolt/);
      // The compensating deduct puts the restored old stock back where it was.
      expect(http.deductStock).toHaveBeenCalledTimes(2);
      expect(http.deductStock).toHaveBeenLastCalledWith(expect.objectContaining({
        containerId: 'tech-2',
        items: [expect.objectContaining({ productId: 'product-1', quantity: 1 })],
      }));
      expect(products.addProduct).not.toHaveBeenCalled();
      expect(products.removeProduct).not.toHaveBeenCalled();
    });

    it('throws if the line is not on the deal', async () => {
      mockFindById(createMockDeal({ assignedTechIds: ['tech-1'] }));
      products.findProduct.mockResolvedValue(null);

      await expect(
        service.replaceProduct('deal-1', 'nonexistent', dto as any, caller),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when the replacement product does not exist in inventory', async () => {
      mockFindById(createMockDeal({ assignedTechIds: ['tech-1'] }));
      http.getProduct.mockResolvedValue(null);

      await expect(
        service.replaceProduct('deal-1', 'product-1', dto as any, caller),
      ).rejects.toThrow(BadRequestException);
      expect(http.restoreStock).not.toHaveBeenCalled();
    });

    it('rejects swapping onto a product that is already a line on the deal', async () => {
      mockFindById(createMockDeal({ assignedTechIds: ['tech-1'] }));
      products.findProduct.mockImplementation(async (_d: string, productId: string) =>
        createMockDealProduct({ productId, sourceTechId: 'tech-1' }),
      );

      await expect(
        service.replaceProduct('deal-1', 'product-1', dto as any, caller),
      ).rejects.toThrow(BadRequestException);
      expect(http.restoreStock).not.toHaveBeenCalled();
      expect(products.addProduct).not.toHaveBeenCalled();
    });

    it('rejects a sourced replacement whose tech is not on the deal', async () => {
      mockFindById(createMockDeal({ assignedTechIds: ['tech-2'] }));

      await expect(
        service.replaceProduct('deal-1', 'product-1', dto as any, caller),
      ).rejects.toThrow(BadRequestException);
      expect(http.restoreStock).not.toHaveBeenCalled();
    });

    it('swapping a sourced part to a service line restores stock and deducts nothing', async () => {
      mockFindById(createMockDeal({ assignedTechIds: ['tech-1'] }));
      http.getProduct.mockResolvedValue({ id: 'product-3', name: 'Rekey', sku: 'SVC-1', type: 'service' });

      await service.replaceProduct(
        'deal-1', 'product-1',
        { ...dto, productId: 'product-3', name: 'Rekey', sku: 'SVC-1', fulfillment: 'service', sourceTechId: undefined } as any,
        caller,
      );

      expect(http.restoreStock).toHaveBeenCalledWith(expect.objectContaining({ containerId: 'tech-2' }));
      expect(http.deductStock).not.toHaveBeenCalled();
      expect(products.addProduct).toHaveBeenCalledWith(
        'deal-1',
        expect.objectContaining({ fulfillment: 'service' }),
      );
      expect(products.addProduct.mock.calls[0][1].sourceTechId).toBeUndefined();
    });

    it('rejects a service-type product replaced in as a sourced line', async () => {
      mockFindById(createMockDeal({ assignedTechIds: ['tech-1'] }));
      http.getProduct.mockResolvedValue({ id: 'product-2', name: 'Rekey', sku: 'SVC-1', type: 'service' });

      await expect(
        service.replaceProduct('deal-1', 'product-1', { ...dto, fulfillment: 'sourced' } as any, caller),
      ).rejects.toThrow(BadRequestException);
    });

    it('keeps orderedAt when a to-order line is edited in place', async () => {
      mockFindById(createMockDeal({ assignedTechIds: [] }));
      products.findProduct.mockResolvedValue(createMockDealProduct({
        fulfillment: 'to_order', sourceTechId: undefined, orderedAt: '2026-05-01T00:00:00.000Z',
      }));
      http.getProduct.mockResolvedValue({
        id: 'product-1', name: 'Kwikset Deadbolt', sku: 'KW-DB-001', type: 'product',
      });

      await service.replaceProduct(
        'deal-1', 'product-1',
        { ...dto, productId: 'product-1', name: 'Kwikset Deadbolt', sku: 'KW-DB-001', fulfillment: 'to_order', sourceTechId: undefined, quantity: 5 } as any,
        caller,
      );

      expect(http.restoreStock).not.toHaveBeenCalled();
      expect(http.deductStock).not.toHaveBeenCalled();
      expect(products.addProduct).toHaveBeenCalledWith('deal-1', expect.objectContaining({
        quantity: 5, orderedAt: '2026-05-01T00:00:00.000Z',
      }));
    });

    it('drops orderedAt when the product is swapped', async () => {
      mockFindById(createMockDeal({ assignedTechIds: [] }));
      products.findProduct.mockImplementation(async (_d: string, productId: string) =>
        productId === 'product-1'
          ? createMockDealProduct({ fulfillment: 'to_order', sourceTechId: undefined, orderedAt: '2026-05-01T00:00:00.000Z' })
          : null,
      );

      await service.replaceProduct(
        'deal-1', 'product-1',
        { ...dto, fulfillment: 'to_order', sourceTechId: undefined } as any,
        caller,
      );

      expect(products.addProduct.mock.calls[0][1].orderedAt).toBeUndefined();
    });

    it('writes a product_updated timeline entry naming both products', async () => {
      mockFindById(createMockDeal({ assignedTechIds: ['tech-1', 'tech-2'] }));

      await service.replaceProduct('deal-1', 'product-1', dto as any, caller);

      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: TimelineEventType.PRODUCT_UPDATED,
          details: expect.objectContaining({
            productId: 'product-2',
            productName: 'Schlage Deadbolt',
            previousProductId: 'product-1',
            previousProductName: 'Kwikset Deadbolt',
            quantity: 2,
          }),
        }),
      );
    });

    it('records price/cost/quantity changes (old → new) in the timeline entry', async () => {
      mockFindById(createMockDeal({ assignedTechIds: ['tech-1', 'tech-2'] }));

      // Existing line: cost 15/20, price 45, qty 1. Replacement: 18/24, 60, 2.
      await service.replaceProduct('deal-1', 'product-1', dto as any, caller);

      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({
            changes: {
              priceClient: { from: 45, to: 60 },
              costCompany: { from: 15, to: 18 },
              costForTech: { from: 20, to: 24 },
              quantity: { from: 1, to: 2 },
            },
          }),
        }),
      );
    });

    it('logs no changes when the numbers stay the same', async () => {
      mockFindById(createMockDeal({ assignedTechIds: ['tech-1', 'tech-2'] }));

      await service.replaceProduct(
        'deal-1',
        'product-1',
        { ...dto, quantity: 1, costCompany: 15, costForTech: 20, priceClient: 45 } as any,
        caller,
      );

      const entry = timeline.addEntry.mock.calls.at(-1)![0];
      expect(entry.details.changes ?? {}).toEqual({});
    });
  });

  describe('updateNote', () => {
    const caller = createMockJwtUser({ id: 'dispatcher-1' });

    it('rewrites the text of a note entry', async () => {
      timeline.getEntry.mockResolvedValue(
        createMockTimelineEntry({
          id: 'entry-1',
          eventType: TimelineEventType.NOTE_ADDED,
          timestamp: '2026-08-01T10:00:00.000Z',
          note: 'Old text',
        }),
      );

      await service.updateNote(
        'deal-1',
        'entry-1',
        { note: 'Edited text', timestamp: '2026-08-01T10:00:00.000Z' } as any,
        caller,
      );

      expect(timeline.updateNote).toHaveBeenCalledWith(
        'deal-1',
        '2026-08-01T10:00:00.000Z',
        'entry-1',
        'Edited text',
      );
    });

    it('404s when the entry does not exist', async () => {
      timeline.getEntry.mockResolvedValue(null);

      await expect(
        service.updateNote('deal-1', 'missing', { note: 'x', timestamp: 't' } as any, caller),
      ).rejects.toThrow(NotFoundException);
      expect(timeline.updateNote).not.toHaveBeenCalled();
    });

    it('refuses to edit a non-note entry', async () => {
      timeline.getEntry.mockResolvedValue(
        createMockTimelineEntry({ eventType: TimelineEventType.FIELD_UPDATED }),
      );

      await expect(
        service.updateNote('deal-1', 'entry-1', { note: 'x', timestamp: 't' } as any, caller),
      ).rejects.toThrow(BadRequestException);
      expect(timeline.updateNote).not.toHaveBeenCalled();
    });
  });

  describe('deleteNote', () => {
    const caller = createMockJwtUser({ id: 'dispatcher-1' });

    it('deletes a note entry', async () => {
      timeline.getEntry.mockResolvedValue(
        createMockTimelineEntry({
          id: 'entry-1',
          eventType: TimelineEventType.NOTE_ADDED,
          timestamp: '2026-08-01T10:00:00.000Z',
        }),
      );

      await service.deleteNote('deal-1', 'entry-1', '2026-08-01T10:00:00.000Z', caller);

      expect(timeline.deleteEntry).toHaveBeenCalledWith(
        'deal-1',
        '2026-08-01T10:00:00.000Z',
        'entry-1',
      );
    });

    it('404s when the entry does not exist and refuses non-notes', async () => {
      timeline.getEntry.mockResolvedValue(null);
      await expect(service.deleteNote('deal-1', 'missing', 't', caller)).rejects.toThrow(
        NotFoundException,
      );

      timeline.getEntry.mockResolvedValue(
        createMockTimelineEntry({ eventType: TimelineEventType.CREATED }),
      );
      await expect(service.deleteNote('deal-1', 'entry-1', 't', caller)).rejects.toThrow(
        BadRequestException,
      );
      expect(timeline.deleteEntry).not.toHaveBeenCalled();
    });
  });

  describe('getProducts', () => {
    it('should return products for deal', async () => {
      mockFindById();
      const mockProducts = [createMockDealProduct()];
      products.findByDeal.mockResolvedValue(mockProducts);

      const result = await service.getProducts('deal-1');

      expect(result).toEqual(mockProducts);
      expect(products.findByDeal).toHaveBeenCalledWith('deal-1');
    });
  });

  describe('getTechDeals', () => {
    it('should query repository by tech ID', async () => {
      const mockResult = { items: [createMockDeal()], nextCursor: undefined };
      repo.findByTech.mockResolvedValue(mockResult);

      const result = await service.getTechDeals('tech-1');

      expect(repo.findByTech).toHaveBeenCalledWith('tech-1', 100);
      expect(result).toEqual(mockResult);
    });
  });

  describe('updatePaymentStatus', () => {
    it('should update deal and add timeline entry', async () => {
      repo.update.mockResolvedValue(createMockDeal());

      await service.updatePaymentStatus('deal-1', {
        paymentId: 'pay-1', amount: 250, paidAt: '2026-04-20T15:00:00.000Z',
      } as any);

      expect(repo.update).toHaveBeenCalledWith('deal-1', {
        paymentStatus: 'paid', actualTotal: 250,
      });
      expect(cache.invalidate).toHaveBeenCalledWith('deal-1');
      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'system',
          actorName: 'Payment Service',
          details: expect.objectContaining({ paymentId: 'pay-1', amount: 250 }),
        }),
      );
    });

    it('publishes deal.updated so payment status reaches the search index', async () => {
      repo.update.mockResolvedValue(createMockDeal());

      await service.updatePaymentStatus('deal-1', {
        paymentId: 'pay-1', amount: 250, paidAt: '2026-04-20T15:00:00.000Z',
      } as any);

      expect(sns.publish).toHaveBeenCalledWith(
        'deal-events',
        'deal.updated',
        expect.objectContaining({ dealId: 'deal-1' }),
      );
    });
  });

  describe('publishEvent (error handling)', () => {
    it('should not crash when SNS publish fails', async () => {
      sns.publish.mockRejectedValue(new Error('Topic not found'));
      repo.reserveDealNumber.mockResolvedValue('K4T9ZW');
      repo.create.mockResolvedValue(undefined);

      const caller = createMockJwtUser({ id: 'dispatcher-1' });
      const dto = {
        contactId: 'c-1', clientType: ClientType.RESIDENTIAL,
        serviceArea: 'ATL', address: { street: '1', city: 'A', state: 'GA', zip: '30301' },
        jobTypeId: 'jobtype-1',
      };

      // Should not throw even though publish fails
      await expect(service.create(dto as any, caller)).resolves.toBeDefined();
    });
  });

  describe('recordCallLink', () => {
    it("stores the actor's display name on the entry, not an email it never had", async () => {
      repo.findById.mockResolvedValue(createMockDeal({ id: 'deal-1' }));

      await service.recordCallLink(
        'deal-1',
        true,
        { direction: 'inbound', from: '+14045551234' },
        { id: 'u-disp', name: 'Olha D.' },
      );

      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: TimelineEventType.CALL_LINKED,
          actorId: 'u-disp',
          actorName: 'Olha D.',
          details: expect.objectContaining({ direction: 'inbound' }),
        }),
      );
    });
  });
});
