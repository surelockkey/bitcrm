import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { SnsPublisherService, BusinessMetricsService } from '@bitcrm/shared';
import { type ExternalCompany } from '@bitcrm/types';
import { randomUUID } from 'crypto';
import { ExternalCompaniesRepository } from './external-companies.repository';
import { type CreateExternalCompanyDto } from './dto/create-external-company.dto';
import { type UpdateExternalCompanyDto } from './dto/update-external-company.dto';

@Injectable()
export class ExternalCompaniesService {
  private readonly logger = new Logger(ExternalCompaniesService.name);

  constructor(
    private readonly repository: ExternalCompaniesRepository,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {}

  /** Names are the picker-facing identity — two "Agero"s would be indistinguishable. */
  private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
    const existing = await this.repository.listAll();
    const clash = existing.find(
      (c) => c.id !== excludeId && c.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );
    if (clash) {
      throw new ConflictException(`An external company named "${clash.name}" already exists`);
    }
  }

  async create(dto: CreateExternalCompanyDto, caller: { id: string }): Promise<ExternalCompany> {
    this.logger.log(`Creating external company "${dto.name}"`);
    await this.assertNameAvailable(dto.name);

    const now = new Date().toISOString();
    const company: ExternalCompany = {
      id: randomUUID(),
      name: dto.name,
      email: dto.email || undefined,
      address: dto.address || undefined,
      phone: dto.phone || undefined,
      active: dto.active ?? true,
      createdBy: caller.id,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(company);
    this.businessMetrics?.entityCreated?.inc({ entity_type: 'external_company' });
    this.publishEvent('external-company.created', { externalCompanyId: company.id, name: company.name });
    return company;
  }

  async list(): Promise<ExternalCompany[]> {
    const companies = await this.repository.listAll();
    return companies.sort((a, b) => a.name.localeCompare(b.name));
  }

  async findById(id: string): Promise<ExternalCompany> {
    const company = await this.repository.get(id);
    if (!company) throw new NotFoundException(`External company ${id} not found`);
    return company;
  }

  async update(
    id: string,
    dto: UpdateExternalCompanyDto,
    caller: { id: string },
  ): Promise<ExternalCompany> {
    const existing = await this.findById(id);
    this.logger.log(`Updating external company ${id}`);

    if (dto.name !== undefined) await this.assertNameAvailable(dto.name, id);

    // Contact fields are clearable: an explicit empty string removes the value.
    const clearable = (next: string | undefined, prev: string | undefined) =>
      next === undefined ? prev : next || undefined;

    const updated: ExternalCompany = {
      ...existing,
      name: dto.name ?? existing.name,
      email: clearable(dto.email, existing.email),
      address: clearable(dto.address, existing.address),
      phone: clearable(dto.phone, existing.phone),
      active: dto.active ?? existing.active,
      updatedAt: new Date().toISOString(),
    };

    await this.repository.put(updated);
    this.publishEvent('external-company.updated', { externalCompanyId: id, name: updated.name });
    return updated;
  }

  /**
   * Archive (disable) rather than destroy when deals still reference the
   * company — historical jobs must keep resolving its name. Unreferenced
   * companies are removed outright.
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
      this.publishEvent('external-company.archived', { externalCompanyId: id, archivedBy: caller.id });
      this.logger.log(`Archived external company ${id} — still referenced by at least one deal`);
      return { archived: true };
    }

    await this.repository.remove(id);
    this.publishEvent('external-company.deleted', { externalCompanyId: id, deletedBy: caller.id });
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
