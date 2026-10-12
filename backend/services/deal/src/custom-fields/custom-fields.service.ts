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
  type CustomFieldEntityType,
  type CustomFieldType,
  customFieldEntityType,
  isOptionCustomFieldType,
} from '@bitcrm/types';
import { randomUUID } from 'crypto';
import { CustomFieldsRepository } from './custom-fields.repository';
import { InternalHttpService } from '../common/services/internal-http.service';
import { type CreateCustomFieldDto } from './dto/create-custom-field.dto';
import { type UpdateCustomFieldDto } from './dto/update-custom-field.dto';

@Injectable()
export class CustomFieldsService {
  private readonly logger = new Logger(CustomFieldsService.name);

  constructor(
    private readonly repository: CustomFieldsRepository,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
    // Where a client field's answers live (crm's contacts): asked before one is deleted.
    @Optional() private readonly internalHttp?: InternalHttpService,
  ) {}

  /**
   * Names are the form-facing identity, so two fields called "Gate Code" would
   * be indistinguishable in every picker. Mirrors the job-type name check.
   * Unique per tab (job / client): a job's "Notes" and a client's "Notes" are
   * never in the same form.
   */
  private async assertNameAvailable(
    name: string,
    entityType: CustomFieldEntityType,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.repository.listAll();
    const clash = existing.find(
      (f) =>
        f.id !== excludeId &&
        customFieldEntityType(f) === entityType &&
        f.name.trim().toLowerCase() === name.trim().toLowerCase(),
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

  /**
   * A client field is answered on the client card, which has no job type and
   * no "close": job types and the required flags are job-field rules (Workiz
   * leaves them unset on its client fields). Refused rather than dropped, so
   * a caller never believes it set one.
   */
  private assertClientFieldRules(
    entityType: CustomFieldEntityType,
    rules: { jobTypeIds?: string[]; required?: boolean; requiredToClose?: boolean },
  ): void {
    if (entityType !== 'client') return;
    if (rules.jobTypeIds && rules.jobTypeIds.length > 0) {
      throw new BadRequestException('A client field does not apply to job types');
    }
    if (rules.required || rules.requiredToClose) {
      throw new BadRequestException('A client field cannot be required');
    }
  }

  async create(dto: CreateCustomFieldDto, caller: { id: string }): Promise<CustomFieldDefinition> {
    this.logger.log(`Creating custom field "${dto.name}"`);
    const entityType = customFieldEntityType(dto);
    this.assertClientFieldRules(entityType, dto);
    await this.assertNameAvailable(dto.name, entityType);
    const options = this.resolveOptions(dto.type, dto.options);

    const now = new Date().toISOString();
    const field: CustomFieldDefinition = {
      id: randomUUID(),
      name: dto.name,
      type: dto.type,
      entityType,
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
    this.publishEvent('custom-field.created', {
      customFieldId: field.id,
      name: field.name,
      entityType,
    });
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

    const entityType = customFieldEntityType(existing);
    this.assertClientFieldRules(entityType, dto);
    if (dto.name !== undefined) await this.assertNameAvailable(dto.name, entityType, id);

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

    if (await this.isInUse(existing)) {
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

  /**
   * Whether anything still holds an answer for the field: a job field's live
   * on the deals, a client field's on crm's contacts. When crm cannot say,
   * the field counts as used — archiving is reversible, deleting is not.
   */
  private async isInUse(field: CustomFieldDefinition): Promise<boolean> {
    if (customFieldEntityType(field) === 'job') {
      return this.repository.isReferencedByDeal(field.id);
    }
    if (!this.internalHttp) return true;
    try {
      return await this.internalHttp.isCustomFieldUsedByContacts(field.id);
    } catch (error) {
      this.logger.warn(
        `Could not ask crm whether client field ${field.id} is answered (${(error as Error).message}); archiving it`,
      );
      return true;
    }
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
