import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { SnsPublisherService, BusinessMetricsService } from '@bitcrm/shared';
import {
  DealStage,
  DealStageGroup,
  DealStatus,
  DealPriority,
  TimelineEventType,
  STAGE_GROUPS,
  type Deal,
  type TimelineEntry,
  type JwtUser,
} from '@bitcrm/types';
import { randomUUID } from 'crypto';
import { DealsRepository } from './deals.repository';
import { DealsCacheService } from './deals-cache.service';
import { TimelineRepository } from '../timeline/timeline.repository';
import { DealProductsRepository } from '../products/deal-products.repository';
import { InternalHttpService } from '../common/services/internal-http.service';
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
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {}

  async create(dto: CreateDealDto, caller: JwtUser): Promise<Deal> {
    const contactExists = await this.internalHttp.validateContact(dto.contactId);
    if (!contactExists) {
      throw new BadRequestException(`Contact ${dto.contactId} not found`);
    }

    const dealNumber = await this.repository.getNextDealNumber();
    const now = new Date().toISOString();
    const id = randomUUID();

    // Convert address class instance to plain object for DynamoDB marshalling
    const address = { ...dto.address };

    const deal: Deal = {
      id,
      dealNumber,
      contactId: dto.contactId,
      companyId: dto.companyId,
      clientType: dto.clientType,
      scheduledDate: dto.scheduledDate,
      scheduledTimeSlot: dto.scheduledTimeSlot,
      serviceArea: dto.serviceArea,
      address,
      jobType: dto.jobType,
      stage: DealStage.NEW_LEAD,
      assignedDispatcherId: caller.id,
      priority: dto.priority || DealPriority.NORMAL,
      source: dto.source,
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
      jobType: deal.jobType,
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
    const limit = query.limit || 20;

    // DataScope enforcement
    if (dataScope === 'assigned_only' && !query.techId) {
      query.techId = caller.id;
    }

    if (query.stage) {
      return this.repository.findByStage(query.stage, limit, query.cursor);
    }
    if (query.techId) {
      return this.repository.findByTech(query.techId, limit, query.cursor);
    }
    if (query.dispatcherId) {
      return this.repository.findByDispatcher(query.dispatcherId, limit, query.cursor);
    }
    if (query.contactId) {
      return this.repository.findByContact(query.contactId, limit, query.cursor);
    }

    return this.repository.findAll(limit, query.cursor, {
      status: query.status,
    });
  }

  async update(id: string, dto: UpdateDealDto, caller: JwtUser): Promise<Deal> {
    await this.findById(id);

    // Convert class instances to plain objects for DynamoDB
    const updates = { ...dto } as any;
    if (updates.address) {
      updates.address = { ...updates.address };
    }

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

  async getQualifiedTechs(id: string) {
    const deal = await this.findById(id);
    const techs = await this.internalHttp.getTechnicians({
      serviceArea: deal.serviceArea,
      skill: deal.jobType,
    });

    if (deal.address.lat && deal.address.lng) {
      return techs
        .map((tech) => {
          const distance =
            tech.homeAddress?.lat && tech.homeAddress?.lng
              ? distanceMiles(
                  deal.address.lat!,
                  deal.address.lng!,
                  tech.homeAddress.lat,
                  tech.homeAddress.lng,
                )
              : null;
          return { ...tech, distanceMiles: distance };
        })
        .sort((a, b) => (a.distanceMiles ?? 999) - (b.distanceMiles ?? 999));
    }

    return techs.map((tech) => ({ ...tech, distanceMiles: null }));
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

  async addProduct(id: string, dto: AddDealProductDto, caller: JwtUser): Promise<void> {
    const deal = await this.findById(id);

    if (!deal.assignedTechId) {
      throw new BadRequestException('Cannot add products without an assigned technician');
    }

    // Deduct from tech's container
    await this.internalHttp.deductStock({
      containerId: deal.assignedTechId,
      items: [{ productId: dto.productId, productName: dto.name, quantity: dto.quantity }],
      dealId: id,
      performedBy: caller.id,
      performedByName: caller.email,
    });

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
