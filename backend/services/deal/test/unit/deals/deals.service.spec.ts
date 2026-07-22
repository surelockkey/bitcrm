import { NotFoundException, BadRequestException, ForbiddenException, HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DealStage, DealStageGroup, DealStatus, TimelineEventType, DealPriority, ClientType } from '@bitcrm/types';
import { DealsService } from 'src/deals/deals.service';
import { DealsRepository } from 'src/deals/deals.repository';
import { DealsCacheService } from 'src/deals/deals-cache.service';
import { TimelineRepository } from 'src/timeline/timeline.repository';
import { DealProductsRepository } from 'src/products/deal-products.repository';
import { InternalHttpService } from 'src/common/services/internal-http.service';
import { ServiceAreasService } from 'src/service-areas/service-areas.service';
import { JobTypesService } from 'src/job-types/job-types.service';
import { TechnicianEligibilityRepository } from 'src/technician-eligibility/technician-eligibility.repository';
import { SnsPublisherService, GeocodingService } from '@bitcrm/shared';
import {
  createMockDeal,
  createMockDealProduct,
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
  createMockTechnicianEligibilityRepository,
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
  let eligibility: ReturnType<typeof createMockTechnicianEligibilityRepository>;

  beforeEach(async () => {
    repo = createMockDealsRepository();
    cache = createMockDealsCacheService();
    timeline = createMockTimelineRepository();
    products = createMockDealProductsRepository();
    sns = createMockSnsPublisherService();
    http = createMockInternalHttpService();
    serviceAreas = { resolvePoint: jest.fn().mockResolvedValue(null) };
    jobTypes = { findById: jest.fn().mockResolvedValue(createMockJobType()) };
    eligibility = createMockTechnicianEligibilityRepository();

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
        { provide: TechnicianEligibilityRepository, useValue: eligibility },
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
    const dto = {
      contactId: 'contact-1',
      clientType: ClientType.RESIDENTIAL,
      serviceArea: 'Atlanta Metro',
      address: { street: '123 Main', city: 'Atlanta', state: 'GA', zip: '30301' },
      jobTypeId: 'jobtype-1',
    };

    it('should create deal with auto-generated fields', async () => {
      repo.getNextDealNumber.mockResolvedValue(1001);
      repo.create.mockResolvedValue(undefined);

      const result = await service.create(dto as any, caller);

      expect(result.id).toBeDefined();
      expect(result.dealNumber).toBe(1001);
      expect(result.stage).toBe(DealStage.NEW_LEAD);
      expect(result.status).toBe(DealStatus.ACTIVE);
      expect(result.assignedDispatcherId).toBe('dispatcher-1');
      expect(result.priority).toBe(DealPriority.NORMAL);
      expect(result.tags).toEqual([]);
      expect(repo.create).toHaveBeenCalled();
    });

    it('auto-resolves serviceAreaId and label from the geocoded address', async () => {
      repo.getNextDealNumber.mockResolvedValue(1001);
      repo.create.mockResolvedValue(undefined);
      serviceAreas.resolvePoint.mockResolvedValue({ id: 'area-9', name: 'North Metro' });

      const result = await service.create(dto as any, caller);

      expect(serviceAreas.resolvePoint).toHaveBeenCalledWith({ lat: 33.749, lng: -84.388 });
      expect(result.serviceAreaId).toBe('area-9');
      expect(result.serviceArea).toBe('North Metro');
    });

    it('falls back to the provided label when no area covers the address', async () => {
      repo.getNextDealNumber.mockResolvedValue(1001);
      repo.create.mockResolvedValue(undefined);
      serviceAreas.resolvePoint.mockResolvedValue(null);

      const result = await service.create(dto as any, caller);

      expect(result.serviceAreaId).toBeUndefined();
      expect(result.serviceArea).toBe('Atlanta Metro');
    });

    it('should use provided priority and tags', async () => {
      repo.getNextDealNumber.mockResolvedValue(1002);
      repo.create.mockResolvedValue(undefined);

      const result = await service.create(
        { ...dto, priority: DealPriority.URGENT, tags: ['vip'] } as any,
        caller,
      );

      expect(result.priority).toBe(DealPriority.URGENT);
      expect(result.tags).toEqual(['vip']);
    });

    it('should validate contact exists', async () => {
      http.validateContact.mockResolvedValue(false);
      await expect(service.create(dto as any, caller)).rejects.toThrow(BadRequestException);
    });

    it('should add CREATED timeline entry', async () => {
      repo.getNextDealNumber.mockResolvedValue(1001);
      repo.create.mockResolvedValue(undefined);

      await service.create(dto as any, caller);

      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: TimelineEventType.CREATED }),
      );
    });

    it('should publish deal.created event', async () => {
      repo.getNextDealNumber.mockResolvedValue(1001);
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

    it('should query by stage when provided', async () => {
      repo.findByStage.mockResolvedValue(mockResult);
      await service.list({ stage: DealStage.NEW_LEAD } as any, caller);
      expect(repo.findByStage).toHaveBeenCalledWith(DealStage.NEW_LEAD, 20, undefined, expect.any(Object));
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

    it('should split comma-separated tags into an array', async () => {
      repo.findByStage.mockResolvedValue(mockResult);
      await service.list({ stage: DealStage.NEW_LEAD, tags: 'rush, repeat' } as any, caller);
      expect(repo.findByStage).toHaveBeenCalledWith(
        DealStage.NEW_LEAD,
        20,
        undefined,
        expect.objectContaining({ tags: ['rush', 'repeat'] }),
      );
    });

    it('should parse a "#1042" search into a dealNumber filter', async () => {
      repo.findAll.mockResolvedValue(mockResult);
      await service.list({ search: '#1042' } as any, caller);
      expect(repo.findAll).toHaveBeenCalledWith(
        20,
        undefined,
        expect.objectContaining({ dealNumber: 1042 }),
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
  });

  describe('changeStage', () => {
    const caller = createMockJwtUser({ id: 'admin-1', roleId: 'role-admin' });

    it('should change stage and add timeline entry', async () => {
      const deal = mockFindById(createMockDeal({ stage: DealStage.NEW_LEAD }));
      repo.update.mockResolvedValue({ ...deal, stage: DealStage.ASSIGNED });

      await service.changeStage('deal-1', { stage: DealStage.ASSIGNED } as any, caller, ['*->*']);

      expect(repo.update).toHaveBeenCalledWith('deal-1', expect.objectContaining({ stage: DealStage.ASSIGNED }));
      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: TimelineEventType.STAGE_CHANGED,
          details: expect.objectContaining({ fromStage: DealStage.NEW_LEAD, toStage: DealStage.ASSIGNED }),
        }),
      );
      expect(cache.invalidate).toHaveBeenCalledWith('deal-1');
    });

    it('should publish deal.stage_changed event', async () => {
      const deal = mockFindById(createMockDeal({ stage: DealStage.NEW_LEAD }));
      repo.update.mockResolvedValue({ ...deal, stage: DealStage.ASSIGNED });

      await service.changeStage('deal-1', { stage: DealStage.ASSIGNED } as any, caller, ['*->*']);

      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'deal.stage_changed', expect.objectContaining({
        dealId: 'deal-1', oldStage: DealStage.NEW_LEAD, newStage: DealStage.ASSIGNED,
      }));
    });

    it('should require cancellationReason when moving to canceled', async () => {
      mockFindById(createMockDeal({ stage: DealStage.NEW_LEAD }));
      await expect(
        service.changeStage('deal-1', { stage: DealStage.CANCELED } as any, caller, ['*->*']),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow canceled with reason', async () => {
      const deal = mockFindById(createMockDeal({ stage: DealStage.NEW_LEAD }));
      repo.update.mockResolvedValue({ ...deal, stage: DealStage.CANCELED });

      await service.changeStage(
        'deal-1', { stage: DealStage.CANCELED, cancellationReason: 'Client resolved' } as any, caller, ['*->*'],
      );

      expect(repo.update).toHaveBeenCalledWith('deal-1', expect.objectContaining({
        stage: DealStage.CANCELED, cancellationReason: 'Client resolved',
      }));
    });

    it('should reject unauthorized transitions', async () => {
      mockFindById(createMockDeal({ stage: DealStage.NEW_LEAD }));
      await expect(
        service.changeStage('deal-1', { stage: DealStage.COMPLETED } as any, caller, []),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should publish deal.completed event for completed stage', async () => {
      const deal = mockFindById(createMockDeal({ stage: DealStage.PENDING_PAYMENT }));
      repo.update.mockResolvedValue({ ...deal, stage: DealStage.COMPLETED });

      await service.changeStage('deal-1', { stage: DealStage.COMPLETED } as any, caller, ['*->*']);

      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'deal.completed', expect.any(Object));
    });

    it('should not publish deal.completed for non-completed stage', async () => {
      const deal = mockFindById(createMockDeal({ stage: DealStage.NEW_LEAD }));
      repo.update.mockResolvedValue({ ...deal, stage: DealStage.ASSIGNED });

      await service.changeStage('deal-1', { stage: DealStage.ASSIGNED } as any, caller, ['*->*']);

      expect(sns.publish).not.toHaveBeenCalledWith('deal-events', 'deal.completed', expect.any(Object));
    });
  });

  describe('getAllowedStages', () => {
    it('should return allowed stages based on transitions', async () => {
      mockFindById(createMockDeal({ stage: DealStage.ASSIGNED }));
      const result = await service.getAllowedStages('deal-1', ['assigned->en_route']);
      expect(result).toEqual([DealStage.EN_ROUTE]);
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

  describe('assignTech', () => {
    const caller = createMockJwtUser({ id: 'dispatcher-1', roleId: 'role-dispatcher' });

    it('should assign tech and add timeline entry', async () => {
      const deal = mockFindById(createMockDeal({ stage: DealStage.NEW_LEAD }));
      repo.update.mockResolvedValue({ ...deal, assignedTechId: 'tech-1', stage: DealStage.ASSIGNED });

      await service.assignTech('deal-1', { techId: 'tech-1' } as any, caller);

      expect(repo.update).toHaveBeenCalledWith('deal-1', expect.objectContaining({ assignedTechId: 'tech-1' }));
      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: TimelineEventType.TECH_ASSIGNED }),
      );
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'deal.tech_assigned', expect.any(Object));
    });

    it('should auto-transition to ASSIGNED from submitted group', async () => {
      const deal = mockFindById(createMockDeal({ stage: DealStage.NEW_LEAD }));
      repo.update.mockResolvedValue({ ...deal, assignedTechId: 'tech-1', stage: DealStage.ASSIGNED });

      await service.assignTech('deal-1', { techId: 'tech-1' } as any, caller);

      expect(repo.update).toHaveBeenCalledWith('deal-1', expect.objectContaining({ stage: DealStage.ASSIGNED }));
    });

    it('should not change stage if not in submitted group', async () => {
      const deal = mockFindById(createMockDeal({ stage: DealStage.FOLLOW_UP }));
      repo.update.mockResolvedValue({ ...deal, assignedTechId: 'tech-1' });

      await service.assignTech('deal-1', { techId: 'tech-1' } as any, caller);

      const updateArg = repo.update.mock.calls[0][1];
      expect(updateArg.stage).toBeUndefined();
    });
  });

  describe('unassignTech', () => {
    const caller = createMockJwtUser({ id: 'dispatcher-1' });

    it('should clear assignedTechId and publish event', async () => {
      const deal = mockFindById(createMockDeal({ assignedTechId: 'tech-1', stage: DealStage.ASSIGNED }));
      repo.update.mockResolvedValue({ ...deal, assignedTechId: undefined });

      await service.unassignTech('deal-1', caller);

      expect(repo.update).toHaveBeenCalledWith('deal-1', expect.objectContaining({ assignedTechId: '' }));
      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: TimelineEventType.TECH_UNASSIGNED }),
      );
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'deal.tech_unassigned', expect.any(Object));
    });

    it('should throw if no tech assigned', async () => {
      mockFindById(createMockDeal({ assignedTechId: undefined }));
      await expect(service.unassignTech('deal-1', caller)).rejects.toThrow(BadRequestException);
    });
  });

  describe('addProduct', () => {
    const caller = createMockJwtUser({ id: 'tech-1' });
    const dto = {
      productId: 'product-1', name: 'Deadbolt', sku: 'KW-001',
      quantity: 1, costCompany: 15, costForTech: 20, priceClient: 45,
    };

    it('should deduct stock and add product to deal', async () => {
      mockFindById(createMockDeal({ assignedTechId: 'tech-1', stage: DealStage.WORK_IN_PROGRESS }));

      await service.addProduct('deal-1', dto as any, caller);

      expect(http.deductStock).toHaveBeenCalled();
      expect(products.addProduct).toHaveBeenCalledWith('deal-1', expect.objectContaining({ productId: 'product-1' }));
      expect(cache.invalidate).toHaveBeenCalledWith('deal-1');
      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: TimelineEventType.PRODUCT_ADDED }),
      );
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'deal.product_added', expect.any(Object));
    });

    it('should throw if no tech assigned', async () => {
      mockFindById(createMockDeal({ assignedTechId: undefined }));
      await expect(service.addProduct('deal-1', dto as any, caller)).rejects.toThrow(BadRequestException);
    });

    it('should turn an insufficient-stock 4xx into a clear BadRequest naming the product', async () => {
      mockFindById(createMockDeal({ assignedTechId: 'tech-1', stage: DealStage.WORK_IN_PROGRESS }));
      http.deductStock.mockRejectedValue(
        new HttpException('Insufficient stock for product product-1', 400),
      );

      const err = await service.addProduct('deal-1', dto as any, caller).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toMatch(/Deadbolt/);
      // The product must NOT be recorded when the deduction was rejected.
      expect(products.addProduct).not.toHaveBeenCalled();
    });
  });

  describe('removeProduct', () => {
    const caller = createMockJwtUser({ id: 'tech-1' });

    it('should restore stock and remove product', async () => {
      const deal = mockFindById(createMockDeal({ assignedTechId: 'tech-1' }));
      const product = createMockDealProduct();
      products.findProduct.mockResolvedValue(product);

      await service.removeProduct('deal-1', 'product-1', caller);

      expect(http.restoreStock).toHaveBeenCalled();
      expect(products.removeProduct).toHaveBeenCalledWith('deal-1', 'product-1');
      expect(cache.invalidate).toHaveBeenCalledWith('deal-1');
      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: TimelineEventType.PRODUCT_REMOVED }),
      );
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'deal.product_removed', expect.any(Object));
    });

    it('should skip restoreStock if no tech assigned', async () => {
      mockFindById(createMockDeal({ assignedTechId: undefined }));
      products.findProduct.mockResolvedValue(createMockDealProduct());

      await service.removeProduct('deal-1', 'product-1', caller);

      expect(http.restoreStock).not.toHaveBeenCalled();
      expect(products.removeProduct).toHaveBeenCalled();
    });

    it('should throw if product not found on deal', async () => {
      mockFindById(createMockDeal({ assignedTechId: 'tech-1' }));
      products.findProduct.mockResolvedValue(null);

      await expect(service.removeProduct('deal-1', 'nonexistent', caller)).rejects.toThrow(NotFoundException);
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
  });

  describe('publishEvent (error handling)', () => {
    it('should not crash when SNS publish fails', async () => {
      sns.publish.mockRejectedValue(new Error('Topic not found'));
      repo.getNextDealNumber.mockResolvedValue(1001);
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
});
