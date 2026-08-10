import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { SnsPublisherService, BusinessMetricsService } from '@bitcrm/shared';
import {
  type CustomFieldDefinition,
  type CustomFieldType,
  isOptionCustomFieldType,
} from '@bitcrm/types';
import { randomUUID } from 'crypto';
import { CustomFieldsRepository } from './custom-fields.repository';
import { type CreateCustomFieldDto } from './dto/create-custom-field.dto';
import { type UpdateCustomFieldDto } from './dto/update-custom-field.dto';

@Injectable()
export class CustomFieldsService {
  private readonly logger = new Logger(CustomFieldsService.name);

  constructor(
    private readonly repository: CustomFieldsRepository,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {}

  /**
   * Names are the form-facing identity, so two fields called "Gate Code" would
   * be indistinguishable in every picker. Mirrors the job-type name check.
   */
  private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
    const existing = await this.repository.listAll();
    const clash = existing.find(
      (f) => f.id !== excludeId && f.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );
    if (clash) {
      throw new ConflictException(`A custom field named "${clash.name}" already exists`);
    }
  }

  /**
   * Only dropdown / multi_select carry a predefined choice list. Those must ship
   * a non-empty list (an empty dropdown renders nothing to pick); every other
   * type must not carry options at all. Returns the normalised list to persist.
   */
  private resolveOptions(type: CustomFieldType, options?: string[]): string[] {
    if (isOptionCustomFieldType(type)) {
      if (!options || options.length === 0) {
        throw new BadRequestException(`A "${type}" field requires at least one option`);
      }
      return options;
    }
    if (options && options.length > 0) {
      throw new BadRequestException(`A "${type}" field does not accept options`);
    }
    return [];
  }

  async create(dto: CreateCustomFieldDto, caller: { id: string }): Promise<CustomFieldDefinition> {
    this.logger.log(`Creating custom field "${dto.name}"`);
    await this.assertNameAvailable(dto.name);
    const options = this.resolveOptions(dto.type, dto.options);

    const now = new Date().toISOString();
    const field: CustomFieldDefinition = {
      id: randomUUID(),
      name: dto.name,
      type: dto.type,
      group: dto.group ?? '',
      options,
      jobTypeIds: dto.jobTypeIds ?? [],
      required: dto.required ?? false,
      requiredToClose: dto.requiredToClose ?? false,
      searchable: dto.searchable ?? false,
      priority: dto.priority ?? 0,
      active: dto.active ?? true,
      createdBy: caller.id,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(field);
    this.businessMetrics?.entityCreated?.inc({ entity_type: 'custom_field' });
    this.publishEvent('custom-field.created', { customFieldId: field.id, name: field.name });
    return field;
  }

  async list(): Promise<CustomFieldDefinition[]> {
    const fields = await this.repository.listAll();
    return fields.sort(
      (a, b) => b.priority - a.priority || a.name.localeCompare(b.name),
    );
  }

  async findById(id: string): Promise<CustomFieldDefinition> {
    const field = await this.repository.get(id);
    if (!field) throw new NotFoundException(`Custom field ${id} not found`);
    return field;
  }

  async update(id: string, dto: UpdateCustomFieldDto, caller: { id: string }): Promise<CustomFieldDefinition> {
    const existing = await this.findById(id);
    this.logger.log(`Updating custom field ${id}`);

    if (dto.name !== undefined) await this.assertNameAvailable(dto.name, id);

    const type = dto.type ?? existing.type;
    const options = this.resolveOptions(type, dto.options ?? existing.options);

    const updated: CustomFieldDefinition = {
      ...existing,
      name: dto.name ?? existing.name,
      type,
      group: dto.group ?? existing.group,
      options,
      jobTypeIds: dto.jobTypeIds ?? existing.jobTypeIds,
      required: dto.required ?? existing.required,
      requiredToClose: dto.requiredToClose ?? existing.requiredToClose,
      searchable: dto.searchable ?? existing.searchable,
      priority: dto.priority ?? existing.priority,
      active: dto.active ?? existing.active,
      updatedAt: new Date().toISOString(),
    };

    await this.repository.put(updated);
    this.publishEvent('custom-field.updated', { customFieldId: id, name: updated.name });
    return updated;
  }

  /**
   * Archive rather than destroy when deals still store answers for the field —
   * otherwise historical deals would render a dangling id. Unreferenced fields
   * are removed outright so a typo doesn't linger in the catalog forever.
   *
   * Returns which of the two happened so the UI can word its toast correctly.
   */
  async remove(id: string, caller: { id: string }): Promise<{ archived: boolean }> {
    const existing = await this.findById(id);

    if (await this.repository.isReferencedByDeal(id)) {
      if (existing.active) {
        await this.repository.put({
          ...existing,
          active: false,
          updatedAt: new Date().toISOString(),
        });
      }
      this.publishEvent('custom-field.archived', { customFieldId: id, archivedBy: caller.id });
      this.logger.log(`Archived custom field ${id} — still referenced by at least one deal`);
      return { archived: true };
    }

    await this.repository.remove(id);
    this.publishEvent('custom-field.deleted', { customFieldId: id, deletedBy: caller.id });
    return { archived: false };
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
