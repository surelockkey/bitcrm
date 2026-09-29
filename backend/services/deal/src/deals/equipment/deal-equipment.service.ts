import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TimelineEventType, type Address, type DealEquipment, type JwtUser } from '@bitcrm/types';
import { TimelineRepository } from '../../timeline/timeline.repository';
import { DealsRepository } from '../deals.repository';
import { DealEquipmentRepository } from './deal-equipment.repository';
import { CreateEquipmentDto, UpdateEquipmentDto } from './dto/equipment.dto';

const addressLine = (a: Address | undefined): string =>
  a ? [a.street, a.unit, a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';

/**
 * Equipment on a job. Access is gated by the `deals` permission at the
 * controller, as for attachments, so no role logic lives here. Every change
 * lands on the job's timeline, best-effort.
 */
@Injectable()
export class DealEquipmentService {
  private readonly logger = new Logger(DealEquipmentService.name);

  constructor(
    private readonly repository: DealEquipmentRepository,
    private readonly deals: DealsRepository,
    private readonly timeline: TimelineRepository,
  ) {}

  private async logTimeline(
    dealId: string,
    eventType: TimelineEventType,
    caller: JwtUser,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.timeline.addEntry({
        id: randomUUID(),
        dealId,
        eventType,
        actorId: caller.id,
        actorName: caller.email,
        timestamp: new Date().toISOString(),
        details,
      });
    } catch (error) {
      this.logger.warn(`Failed to log ${eventType} on deal ${dealId}: ${(error as Error).message}`);
    }
  }

  async list(dealId: string): Promise<DealEquipment[]> {
    const items = await this.repository.listByDeal(dealId);
    return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async create(dealId: string, dto: CreateEquipmentDto, caller: JwtUser): Promise<DealEquipment> {
    const deal = await this.deals.findById(dealId);
    if (!deal) throw new NotFoundException('Job not found');
    const now = new Date().toISOString();
    const eq: DealEquipment = {
      ...stripEmpty(dto),
      id: randomUUID(),
      dealId,
      contactId: deal.contactId,
      name: dto.name.trim(),
      model: dto.model.trim(),
      propertyAddress: dto.propertyAddress?.trim() || addressLine(deal.address) || undefined,
      createdBy: caller.id,
      createdAt: now,
      updatedAt: now,
    };
    if (!eq.propertyAddress) delete eq.propertyAddress;
    await this.repository.create(eq);
    this.logger.log(`Equipment added: ${dealId}/${eq.id} by ${caller.id}`);
    await this.logTimeline(dealId, TimelineEventType.EQUIPMENT_ADDED, caller, {
      equipmentId: eq.id,
      name: eq.name,
      model: eq.model,
    });
    return eq;
  }

  async update(dealId: string, id: string, dto: UpdateEquipmentDto, caller: JwtUser): Promise<DealEquipment> {
    const current = await this.repository.get(dealId, id);
    if (!current) throw new NotFoundException('Equipment not found');
    const patch: Record<string, string | null | undefined> = {};
    for (const [k, v] of Object.entries(dto)) {
      if (v === undefined) continue;
      patch[k] = typeof v === 'string' ? v.trim() || null : v;
    }
    // Name and model are required: an empty one is ignored, never cleared.
    for (const k of ['name', 'model']) if (patch[k] === null) delete patch[k];
    const changed = Object.keys(patch).filter((k) => (patch[k] ?? undefined) !== (current as unknown as Record<string, unknown>)[k]);
    const updated = await this.repository.update(dealId, id, { ...patch, updatedAt: new Date().toISOString() });
    if (changed.length) {
      await this.logTimeline(dealId, TimelineEventType.EQUIPMENT_UPDATED, caller, {
        equipmentId: id,
        name: updated.name,
        changed,
      });
    }
    return updated;
  }

  async delete(dealId: string, id: string, caller: JwtUser): Promise<void> {
    const current = await this.repository.get(dealId, id);
    if (!current) throw new NotFoundException('Equipment not found');
    await this.repository.delete(dealId, id);
    await this.logTimeline(dealId, TimelineEventType.EQUIPMENT_REMOVED, caller, {
      equipmentId: id,
      name: current.name,
      model: current.model,
    });
  }
}

/** Optional fields left blank in the form are not stored. */
function stripEmpty<T extends object>(dto: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(dto)) {
    if (typeof v === 'string' && v.trim()) (out as Record<string, unknown>)[k] = v.trim();
  }
  return out;
}
