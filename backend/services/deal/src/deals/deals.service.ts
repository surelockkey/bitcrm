import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  Optional,
} from '@nestjs/common';
import {
  SnsPublisherService,
  BusinessMetricsService,
  GeocodingService,
  formatAddress,
} from '@bitcrm/shared';
import {
  DealStage,
  DealStageGroup,
  DealStatus,
  DealPriority,
  TimelineEventType,
  STAGE_GROUPS,
  TERMINAL_STAGES,
  type Address,
  type Deal,
  type TimelineEntry,
  type JwtUser,
} from '@bitcrm/types';
import { randomUUID } from 'crypto';
import { DealsRepository, type DealFilters } from './deals.repository';
import { DealsCacheService } from './deals-cache.service';
import { TimelineRepository } from '../timeline/timeline.repository';
import { DealProductsRepository } from '../products/deal-products.repository';
import { InternalHttpService } from '../common/services/internal-http.service';
import { ServiceAreasService } from '../service-areas/service-areas.service';
import { JobTypesService } from '../job-types/job-types.service';
import { JobSourcesService } from '../job-sources/job-sources.service';
import { TechnicianEligibilityRepository } from '../technician-eligibility/technician-eligibility.repository';
import { canTransition, getAllowedNextStages } from '../common/constants/stage-transitions';
import { distanceMiles } from '../common/utils/haversine';
import { type CreateDealDto } from './dto/create-deal.dto';
import { type UpdateDealDto } from './dto/update-deal.dto';
import { type ChangeStageDto } from './dto/change-stage.dto';
import { type ListDealsQueryDto } from './dto/list-deals-query.dto';
import { type AddNoteDto } from './dto/add-note.dto';
import { type AssignTechDto } from './dto/assign-tech.dto';
import { type AddDealProductDto } from './dto/add-deal-product.dto';
import { type UpdatePaymentStatusDto } from './dto/update-payment-status.dto';

@Injectable()
export class DealsService {
  private readonly logger = new Logger(DealsService.name);

  constructor(
    private readonly repository: DealsRepository,
    private readonly cache: DealsCacheService,
    private readonly timelineRepo: TimelineRepository,
    private readonly productsRepo: DealProductsRepository,
    private readonly internalHttp: InternalHttpService,
    private readonly geocoding: GeocodingService,
    private readonly serviceAreas: ServiceAreasService,
    private readonly jobTypes: JobTypesService,
    private readonly jobSources: JobSourcesService,
    private readonly eligibility: TechnicianEligibilityRepository,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {}

  /**
   * Attach coordinates to an address so the deal can be plotted on the dispatch
   * map and ranked by distance in `getQualifiedTechs`.
   *
   * DynamoDB writes `address` as one whole map, so any sub-key the caller omits
   * is destroyed. That is how coordinates used to vanish: the edit form re-sends
   * the address without lat/lng and the stored ones were overwritten. Hence the
   * carry-over below — an unchanged address keeps the coordinates it already had
   * rather than paying to geocode the same string again.
   */
  private async resolveAddress(
    incoming: Address,
    previous?: Address,
  ): Promise<Address> {
    const address = { ...incoming };

    if (address.lat !== undefined && address.lng !== undefined) {
      return address;
    }

    if (
      previous?.lat !== undefined &&
      previous?.lng !== undefined &&
      formatAddress(previous) === formatAddress(address)
    ) {
      return { ...address, lat: previous.lat, lng: previous.lng };
    }

    const coords = await this.geocoding.geocode(address);
    return coords ? { ...address, ...coords } : address;
  }

  /**
   * Resolve the catalog service area covering a geocoded address. Returns the
   * matched area's id + name; falls back to the caller-supplied label (or '')
   * when the address is uncoordinated or outside every area.
   */
  private async resolveServiceArea(
    address: Address,
    fallbackLabel?: string,
  ): Promise<{ serviceAreaId?: string; serviceArea: string }> {
    if (address.lat === undefined || address.lng === undefined) {
      return { serviceArea: fallbackLabel ?? '' };
    }
    const area = await this.serviceAreas.resolvePoint({
      lat: address.lat,
      lng: address.lng,
    });
    if (!area) {
      this.logger.log(`No service area covers deal address; leaving unassigned`);
      return { serviceArea: fallbackLabel ?? '' };
    }
    return { serviceAreaId: area.id, serviceArea: area.name };
  }

  async create(dto: CreateDealDto, caller: JwtUser): Promise<Deal> {
    const contactExists = await this.internalHttp.validateContact(dto.contactId);
    if (!contactExists) {
      throw new BadRequestException(`Contact ${dto.contactId} not found`);
    }

    const dealNumber = await this.repository.getNextDealNumber();
    const now = new Date().toISOString();
    const id = randomUUID();

    // Plain object for DynamoDB marshalling, geocoded if the caller sent no coords.
    const address = await this.resolveAddress(dto.address);

    // Auto-resolve the catalog service area from the geocoded location. A match
    // is authoritative for the display label; an explicit dto.serviceArea is a
    // fallback used only when the address falls outside every area.
    const { serviceAreaId, serviceArea } = await this.resolveServiceArea(address, dto.serviceArea);

    // 404s on an unknown id; a new deal may not use an archived type.
    const jobType = await this.jobTypes.findById(dto.jobTypeId);
    if (!jobType.active) {
      throw new BadRequestException(`Job type "${jobType.name}" is archived and cannot be used on a new deal`);
    }

    // Source is optional; validate only when supplied, and reject an archived one.
    if (dto.sourceId) {
      const source = await this.jobSources.findById(dto.sourceId);
      if (!source.active) {
        throw new BadRequestException(`Job source "${source.name}" is archived and cannot be used on a new deal`);
      }
    }

    const deal: Deal = {
      id,
      dealNumber,
      contactId: dto.contactId,
      companyId: dto.companyId,
      clientType: dto.clientType,
      scheduledDate: dto.scheduledDate,
      scheduledTimeSlot: dto.scheduledTimeSlot,
      serviceArea,
      serviceAreaId,
      address,
      jobTypeId: dto.jobTypeId,
      stage: DealStage.NEW_LEAD,
      assignedDispatcherId: caller.id,
      priority: dto.priority || DealPriority.NORMAL,
      sourceId: dto.sourceId,
      notes: dto.notes,
      tags: dto.tags || [],
      status: DealStatus.ACTIVE,
      createdBy: caller.id,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(deal);
    this.businessMetrics?.entityCreated.inc({ entity_type: 'deal' });

    await this.addTimelineEntry(deal.id, TimelineEventType.CREATED, caller, {});

    this.publishEvent('deal.created', {
      dealId: deal.id,
      dealNumber: deal.dealNumber,
      contactId: deal.contactId,
      jobTypeId: deal.jobTypeId,
      stage: deal.stage,
      createdBy: caller.id,
    });

    return deal;
  }

  async findById(id: string): Promise<Deal> {
    const cached = await this.cache.get(id);
    if (cached) {
      this.businessMetrics?.cacheHits.inc({ entity_type: 'deal' });
      return cached;
    }

    this.businessMetrics?.cacheMisses.inc({ entity_type: 'deal' });
    const deal = await this.repository.findById(id);
    if (!deal) {
      throw new NotFoundException(`Deal ${id} not found`);
    }

    await this.cache.set(deal);
    return deal;
  }

  async list(
    query: ListDealsQueryDto,
    caller: JwtUser,
    dataScope?: string,
  ) {
    // Query params arrive as strings (no global ValidationPipe/transform), so
    // coerce — a string Limit makes DynamoDB throw SerializationException.
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);

    // DataScope enforcement
    if (dataScope === 'assigned_only' && !query.techId) {
      query.techId = caller.id;
    }

    // Secondary filters applied on top of whichever index we query.
    const search = query.search?.trim();
    const filters: DealFilters = {
      jobTypeId: query.jobTypeId,
      sourceId: query.sourceId,
      serviceArea: query.serviceArea,
      clientType: query.clientType,
      priority: query.priority,
      tags: query.tags
        ? query.tags.split(',').map((t) => t.trim()).filter(Boolean)
        : undefined,
      dealNumber:
        search && /^#?\d+$/.test(search) ? Number(search.replace('#', '')) : undefined,
    };

    if (query.stage) {
      return this.repository.findByStage(query.stage, limit, query.cursor, filters);
    }
    if (query.techId) {
      return this.repository.findByTech(query.techId, limit, query.cursor, filters);
    }
    if (query.dispatcherId) {
      return this.repository.findByDispatcher(query.dispatcherId, limit, query.cursor, filters);
    }
    if (query.contactId) {
      return this.repository.findByContact(query.contactId, limit, query.cursor, filters);
    }

    return this.repository.findAll(limit, query.cursor, {
      status: query.status,
      ...filters,
    });
  }

  async update(id: string, dto: UpdateDealDto, caller: JwtUser): Promise<Deal> {
    const existing = await this.findById(id);

    // Convert class instances to plain objects for DynamoDB
    const updates = { ...dto } as any;
    if (updates.address) {
      updates.address = await this.resolveAddress(
        updates.address,
        existing.address,
      );
      // Re-resolve the catalog service area whenever the address changes, so an
      // edited location moves the deal into the right territory (create-parity).
      const { serviceAreaId, serviceArea } = await this.resolveServiceArea(
        updates.address,
        updates.serviceArea ?? existing.serviceArea,
      );
      updates.serviceArea = serviceArea;
      updates.serviceAreaId = serviceAreaId;
    }

    // Archived types are allowed on update so an old deal stays editable; only
    // the id's existence is enforced.
    if (updates.jobTypeId) await this.jobTypes.findById(updates.jobTypeId);
    // Archived source allowed on update so an old deal stays editable.
    if (updates.sourceId) await this.jobSources.findById(updates.sourceId);

    const result = await this.repository.update(id, updates);
    await this.cache.invalidate(id);

    // Track field changes in timeline
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) {
        await this.addTimelineEntry(id, TimelineEventType.FIELD_UPDATED, caller, {
          field: key,
          newValue: value,
        });
      }
    }

    return result;
  }

  async softDelete(id: string, caller: JwtUser): Promise<void> {
    await this.findById(id);
    await this.repository.softDelete(id);
    await this.cache.invalidate(id);
  }

  async changeStage(
    id: string,
    dto: ChangeStageDto,
    caller: JwtUser,
    dealStageTransitions: string[],
  ): Promise<Deal> {
    const deal = await this.findById(id);

    // Validate transition
    if (!canTransition(dealStageTransitions, deal.stage, dto.stage)) {
      throw new ForbiddenException(
        `Cannot transition from ${deal.stage} to ${dto.stage}`,
      );
    }

    // Require cancellation reason
    if (dto.stage === DealStage.CANCELED && !dto.cancellationReason) {
      throw new BadRequestException('cancellationReason is required when canceling a deal');
    }

    const updates: Partial<Deal> = { stage: dto.stage };
    if (dto.cancellationReason) {
      updates.cancellationReason = dto.cancellationReason;
    }

    const result = await this.repository.update(id, updates);
    await this.cache.invalidate(id);
    this.businessMetrics?.dealStageTransitions.inc({ from_stage: deal.stage, to_stage: dto.stage });

    await this.addTimelineEntry(id, TimelineEventType.STAGE_CHANGED, caller, {
      fromStage: deal.stage,
      toStage: dto.stage,
    });

    this.publishEvent('deal.stage_changed', {
      dealId: id,
      oldStage: deal.stage,
      newStage: dto.stage,
      changedBy: caller.id,
    });

    if (dto.stage === DealStage.COMPLETED) {
      this.publishEvent('deal.completed', {
        dealId: id,
        completedAt: new Date().toISOString(),
      });
    }

    return result;
  }

  async getAllowedStages(id: string, dealStageTransitions: string[]) {
    const deal = await this.findById(id);
    return getAllowedNextStages(dealStageTransitions, deal.stage);
  }

  async getTimeline(dealId: string, limit = 20, cursor?: string) {
    await this.findById(dealId); // verify deal exists
    return this.timelineRepo.findByDeal(dealId, limit, cursor);
  }

  async addNote(id: string, dto: AddNoteDto, caller: JwtUser): Promise<void> {
    await this.findById(id);
    await this.addTimelineEntry(id, TimelineEventType.NOTE_ADDED, caller, {}, dto.note);
  }

  /**
   * Candidates for assigning this deal, read from the local eligibility
   * projection rather than user-service — the ids there are catalog ids, so the
   * match is exact. (The previous implementation compared a deal's `lock_change`
   * slug against a technician's hand-typed "Lock Change", and so returned
   * nothing.)
   *
   * Every technician is returned, not just the matching ones: dispatchers keep
   * the right to override, and `eligible` + `reasons` let the UI say why someone
   * doesn't qualify instead of silently hiding them.
   */
  async getQualifiedTechs(id: string) {
    const deal = await this.findById(id);
    const candidates = await this.eligibility.listAll();

    return candidates
      .map((tech) => {
        const reasons: string[] = [];
        if (!tech.assignable) reasons.push('not_assignable');
        if (!tech.jobTypeIds.includes(deal.jobTypeId)) reasons.push('missing_job_type');
        if (!deal.serviceAreaId || !tech.serviceAreaIds.includes(deal.serviceAreaId)) {
          reasons.push('outside_area');
        }

        const distance =
          deal.address.lat !== undefined &&
          deal.address.lng !== undefined &&
          tech.homeAddress?.lat !== undefined &&
          tech.homeAddress?.lng !== undefined
            ? distanceMiles(
                deal.address.lat,
                deal.address.lng,
                tech.homeAddress.lat,
                tech.homeAddress.lng,
              )
            : null;

        return {
          id: tech.technicianId,
          firstName: tech.firstName,
          lastName: tech.lastName,
          department: tech.department,
          jobTypeIds: tech.jobTypeIds,
          serviceAreaIds: tech.serviceAreaIds,
          eligible: reasons.length === 0,
          reasons,
          distanceMiles: distance,
        };
      })
      .sort(
        (a, b) =>
          Number(b.eligible) - Number(a.eligible) ||
          (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity),
      );
  }

  async assignTech(id: string, dto: AssignTechDto, caller: JwtUser): Promise<Deal> {
    const deal = await this.findById(id);

    const updates: Partial<Deal> = { assignedTechId: dto.techId };

    // Auto-transition to ASSIGNED if in submitted group
    const group = STAGE_GROUPS[deal.stage];
    if (group === DealStageGroup.SUBMITTED) {
      updates.stage = DealStage.ASSIGNED;
    }

    const result = await this.repository.update(id, updates);
    await this.cache.invalidate(id);
    this.businessMetrics?.dealTechAssignments.inc();

    // Slot the job into the technician's day by scheduled time.
    await this.renumberTechSchedule(dto.techId, deal.scheduledDate);

    await this.addTimelineEntry(id, TimelineEventType.TECH_ASSIGNED, caller, {
      techId: dto.techId,
    });

    this.publishEvent('deal.tech_assigned', {
      dealId: id,
      techId: dto.techId,
      assignedBy: caller.id,
    });

    return result;
  }

  async unassignTech(id: string, caller: JwtUser): Promise<Deal> {
    const deal = await this.findById(id);

    if (!deal.assignedTechId) {
      throw new BadRequestException('No technician assigned to this deal');
    }

    const previousTechId = deal.assignedTechId;
    const result = await this.repository.update(id, { assignedTechId: '' } as any);
    await this.cache.invalidate(id);

    // Close the gap the removed job left in the technician's sequence.
    await this.renumberTechSchedule(previousTechId, deal.scheduledDate);

    await this.addTimelineEntry(id, TimelineEventType.TECH_UNASSIGNED, caller, {
      previousTechId,
    });

    this.publishEvent('deal.tech_unassigned', {
      dealId: id,
      techId: previousTechId,
      unassignedBy: caller.id,
    });

    return result;
  }

  /** Every active deal a technician has, drained across pages. */
  private async listTechDeals(techId: string): Promise<Deal[]> {
    const all: Deal[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.repository.findByTech(techId, 100, cursor);
      all.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor && all.length < 500);
    return all.filter((d) => !TERMINAL_STAGES.has(d.stage));
  }

  /**
   * Renumber a technician's schedule for a day: earliest scheduled job is [1].
   * Jobs are visited in scheduled-time order (EPIC-4's time-based sequencing),
   * so assigning or removing one keeps the badges contiguous and correct.
   */
  private async renumberTechSchedule(
    techId: string,
    date?: string,
  ): Promise<void> {
    if (!techId) return;

    const deals = (await this.listTechDeals(techId))
      .filter((d) => !date || d.scheduledDate === date)
      .sort((a, b) =>
        (a.scheduledTimeSlot ?? '~').localeCompare(b.scheduledTimeSlot ?? '~'),
      );

    await this.writeSequence(deals.map((d) => d.id));
  }

  /** Persist sequenceNumber 1..N for the given deal ids, in order. */
  private async writeSequence(orderedIds: string[]): Promise<void> {
    await Promise.all(
      orderedIds.map((id, index) =>
        this.repository.update(id, { sequenceNumber: index + 1 } as Partial<Deal>),
      ),
    );
    for (const id of orderedIds) await this.cache.invalidate(id);
  }

  /**
   * Manual drag-to-reorder of a technician's day. Writes the sequence in the
   * given order, ignoring any id that isn't actually this technician's.
   */
  async reorderSchedule(
    dto: { techId: string; orderedDealIds: string[] },
    caller: JwtUser,
  ): Promise<void> {
    const owned = new Set(
      (await this.listTechDeals(dto.techId)).map((d) => d.id),
    );
    const ordered = dto.orderedDealIds.filter((id) => owned.has(id));

    await this.writeSequence(ordered);

    for (const id of ordered) {
      await this.addTimelineEntry(id, TimelineEventType.FIELD_UPDATED, caller, {
        field: 'sequenceNumber',
        newValue: ordered.indexOf(id) + 1,
      });
    }
  }

  async addProduct(id: string, dto: AddDealProductDto, caller: JwtUser): Promise<void> {
    const deal = await this.findById(id);

    if (!deal.assignedTechId) {
      throw new BadRequestException('Cannot add products without an assigned technician');
    }

    // Deduct from tech's container. A 4xx here (e.g. the tech doesn't carry
    // enough of this product) is a client error, not a server fault — surface
    // it as a clear message referencing the product by name.
    try {
      await this.internalHttp.deductStock({
        containerId: deal.assignedTechId,
        items: [{ productId: dto.productId, productName: dto.name, quantity: dto.quantity }],
        dealId: id,
        performedBy: caller.id,
        performedByName: caller.email,
      });
    } catch (error) {
      if (
        error instanceof HttpException &&
        error.getStatus() >= 400 &&
        error.getStatus() < 500
      ) {
        throw new BadRequestException(
          `The assigned technician doesn't have enough "${dto.name}" in their container to add to this deal.`,
        );
      }
      throw error;
    }

    this.businessMetrics?.dealProductsAdded.inc();
    await this.productsRepo.addProduct(id, {
      productId: dto.productId,
      name: dto.name,
      sku: dto.sku,
      quantity: dto.quantity,
      costCompany: dto.costCompany,
      costForTech: dto.costForTech,
      priceClient: dto.priceClient,
      addedBy: caller.id,
      addedAt: new Date().toISOString(),
    });

    await this.cache.invalidate(id);

    await this.addTimelineEntry(id, TimelineEventType.PRODUCT_ADDED, caller, {
      productId: dto.productId,
      productName: dto.name,
      quantity: dto.quantity,
    });

    this.publishEvent('deal.product_added', {
      dealId: id,
      productId: dto.productId,
      quantity: dto.quantity,
    });
  }

  async removeProduct(id: string, productId: string, caller: JwtUser): Promise<void> {
    const deal = await this.findById(id);

    const product = await this.productsRepo.findProduct(id, productId);
    if (!product) {
      throw new NotFoundException(`Product ${productId} not found on deal ${id}`);
    }

    // Restore to tech's container
    if (deal.assignedTechId) {
      await this.internalHttp.restoreStock({
        containerId: deal.assignedTechId,
        items: [{ productId: product.productId, productName: product.name, quantity: product.quantity }],
        dealId: id,
        performedBy: caller.id,
        performedByName: caller.email,
      });
    }

    await this.productsRepo.removeProduct(id, productId);
    await this.cache.invalidate(id);

    await this.addTimelineEntry(id, TimelineEventType.PRODUCT_REMOVED, caller, {
      productId: product.productId,
      productName: product.name,
    });

    this.publishEvent('deal.product_removed', {
      dealId: id,
      productId,
    });
  }

  async getProducts(id: string) {
    await this.findById(id);
    return this.productsRepo.findByDeal(id);
  }

  // Internal endpoints (service-to-service)
  async getTechDeals(techId: string) {
    return this.repository.findByTech(techId, 100);
  }

  /** Thin passthrough for the search-service backfill/indexer. */
  async findAll(limit: number, cursor?: string) {
    return this.repository.findAll(limit, cursor);
  }

  async updatePaymentStatus(id: string, dto: UpdatePaymentStatusDto): Promise<void> {
    await this.repository.update(id, {
      paymentStatus: 'paid',
      actualTotal: dto.amount,
    } as any);
    await this.cache.invalidate(id);

    await this.timelineRepo.addEntry({
      id: randomUUID(),
      dealId: id,
      eventType: TimelineEventType.FIELD_UPDATED,
      actorId: 'system',
      actorName: 'Payment Service',
      timestamp: new Date().toISOString(),
      details: {
        field: 'paymentStatus',
        newValue: 'paid',
        paymentId: dto.paymentId,
        amount: dto.amount,
      },
    });
  }

  // Private helpers

  private async addTimelineEntry(
    dealId: string,
    eventType: TimelineEventType,
    caller: JwtUser,
    details: Record<string, unknown>,
    note?: string,
  ): Promise<void> {
    const entry: TimelineEntry = {
      id: randomUUID(),
      dealId,
      eventType,
      actorId: caller.id,
      actorName: caller.email,
      timestamp: new Date().toISOString(),
      details,
      note,
    };
    await this.timelineRepo.addEntry(entry);
  }

  private publishEvent(eventType: string, payload: Record<string, unknown>): void {
    this.snsPublisher?.publish('deal-events', eventType, payload)
      .then(() => this.businessMetrics?.eventsPublished.inc({ event_type: eventType }))
      .catch((error: any) => {
        this.businessMetrics?.eventsFailed.inc({ event_type: eventType });
        this.logger.warn(`Failed to publish ${eventType}: ${error.message}`);
      });
  }
}
