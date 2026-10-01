import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { SnsPublisherService, BusinessMetricsService } from '@bitcrm/shared';
import { type ClientTag } from '@bitcrm/types';
import { randomUUID } from 'crypto';
import { ClientTagsRepository } from './client-tags.repository';
import { type CreateClientTagDto } from './dto/create-client-tag.dto';
import { type UpdateClientTagDto } from './dto/update-client-tag.dto';

@Injectable()
export class ClientTagsService {
  private readonly logger = new Logger(ClientTagsService.name);

  constructor(
    private readonly repository: ClientTagsRepository,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {}

  /**
   * Names are the dispatcher-facing identity, so two types called "Rekey" would
   * be indistinguishable in every picker. This is the client-tag analogue of the
   * service-area overlap check.
   */
  private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
    const existing = await this.repository.listAll();
    const clash = existing.find(
      (t) => t.id !== excludeId && t.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );
    if (clash) {
      throw new ConflictException(`A client tag named "${clash.name}" already exists`);
    }
  }

  async create(dto: CreateClientTagDto, caller: { id: string }): Promise<ClientTag> {
    this.logger.log(`Creating client tag "${dto.name}"`);
    await this.assertNameAvailable(dto.name);

    const now = new Date().toISOString();
    const clientTag: ClientTag = {
      id: randomUUID(),
      name: dto.name,
      color: dto.color ?? 'slate',
      priority: dto.priority ?? 0,
      active: dto.active ?? true,
      createdBy: caller.id,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(clientTag);
    this.businessMetrics?.entityCreated?.inc({ entity_type: 'client_tag' });
    this.publishEvent('client-tag.created', { clientTagId: clientTag.id, name: clientTag.name });
    return clientTag;
  }

  async list(): Promise<ClientTag[]> {
    const clientTags = await this.repository.listAll();
    return clientTags.sort(
      (a, b) => b.priority - a.priority || a.name.localeCompare(b.name),
    );
  }

  async findById(id: string): Promise<ClientTag> {
    const clientTag = await this.repository.get(id);
    if (!clientTag) throw new NotFoundException(`Client tag ${id} not found`);
    return clientTag;
  }

  async update(id: string, dto: UpdateClientTagDto, caller: { id: string }): Promise<ClientTag> {
    const existing = await this.findById(id);
    this.logger.log(`Updating client tag ${id}`);

    if (dto.name !== undefined) await this.assertNameAvailable(dto.name, id);

    const updated: ClientTag = {
      ...existing,
      name: dto.name ?? existing.name,
      color: dto.color ?? existing.color,
      priority: dto.priority ?? existing.priority,
      active: dto.active ?? existing.active,
      updatedAt: new Date().toISOString(),
    };

    await this.repository.put(updated);
    this.publishEvent('client-tag.updated', { clientTagId: id, name: updated.name });
    return updated;
  }

  /**
   * A client tag is only ever archived, never destroyed: the clients wearing it
   * live in the CRM table this service cannot scan, so there is no cheap way to
   * know whether it is still referenced. Archived tags leave the pickers and
   * keep resolving on the cards that carry them.
   */
  async remove(id: string, caller: { id: string }): Promise<{ archived: boolean }> {
    const existing = await this.findById(id);
    if (existing.active) {
      await this.repository.put({ ...existing, active: false, updatedAt: new Date().toISOString() });
    }
    this.publishEvent('client-tag.archived', { clientTagId: id, archivedBy: caller.id });
    this.logger.log(`Archived client tag ${id}`);
    return { archived: true };
  }

  private publishEvent(eventType: string, payload: Record<string, unknown>): void {
    this.snsPublisher
      ?.publish('deal-events', eventType, payload)
      .then(() => this.businessMetrics?.eventsPublished?.inc({ event_type: eventType }))
      .catch((error: Error) => {
        this.businessMetrics?.eventsFailed?.inc({ event_type: eventType });
        this.logger.warn(`Failed to publish ${eventType}: ${error.message}`);
      });
  }
}
