import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { SnsPublisherService, BusinessMetricsService } from '@bitcrm/shared';
import { CrmStatus, type Company, type JwtUser } from '@bitcrm/types';
import { randomUUID } from 'crypto';
import { CompaniesRepository } from './companies.repository';
import { CompaniesCacheService } from './companies-cache.service';
import { type CreateCompanyDto } from './dto/create-company.dto';
import { type UpdateCompanyDto } from './dto/update-company.dto';

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(
    private readonly repository: CompaniesRepository,
    private readonly cache: CompaniesCacheService,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {}

  async create(dto: CreateCompanyDto, caller: JwtUser): Promise<Company> {
    const now = new Date().toISOString();
    const company: Company = {
      id: randomUUID(),
      title: dto.title,
      phones: dto.phones || [],
      emails: dto.emails || [],
      address: dto.address,
      website: dto.website,
      clientType: dto.clientType,
      notes: dto.notes,
      status: CrmStatus.ACTIVE,
      createdBy: caller.id,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(company);
    this.businessMetrics?.entityCreated.inc({ entity_type: 'company' });
    this.publishEvent('company.created', { companyId: company.id, title: company.title });

    return company;
  }

  async findById(id: string): Promise<Company> {
    const cached = await this.cache.get(id);
    if (cached) {
      this.businessMetrics?.cacheHits.inc({ entity_type: 'company' });
      return cached;
    }

    this.businessMetrics?.cacheMisses.inc({ entity_type: 'company' });
    const company = await this.repository.findById(id);
    if (!company) throw new NotFoundException('Company not found');

    await this.cache.set(company);
    return company;
  }

  async list(query: { clientType?: string; limit?: number; cursor?: string }) {
    const limit = query.limit || 20;

    if (query.clientType) {
      return this.repository.findByClientType(query.clientType, limit, query.cursor);
    }

    return this.repository.findAll(limit, query.cursor);
  }

  async update(id: string, dto: UpdateCompanyDto): Promise<Company> {
    await this.findById(id);
    const updated = await this.repository.update(id, dto);
    await this.cache.invalidate(id);
    this.businessMetrics?.entityUpdated.inc({ entity_type: 'company' });
    this.publishEvent('company.updated', { companyId: id });

    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.findById(id);
    await this.repository.update(id, { status: CrmStatus.DELETED } as any);
    await this.cache.invalidate(id);
    this.businessMetrics?.entityDeleted.inc({ entity_type: 'company' });
  }

  private publishEvent(eventType: string, payload: Record<string, unknown>): void {
    if (!this.snsPublisher) return;
    this.snsPublisher
      .publish('crm', eventType, payload)
      .then(() => this.businessMetrics?.eventsPublished.inc({ event_type: eventType }))
      .catch((err) => {
        this.businessMetrics?.eventsFailed.inc({ event_type: eventType });
        this.logger.warn(`Failed to publish ${eventType}: ${err.message}`);
      });
  }
}
