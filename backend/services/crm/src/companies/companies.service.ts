import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  SnsPublisherService,
  BusinessMetricsService,
  tryNormalizePhone,
  normalizePhoneExtensions,
} from '@bitcrm/shared';
import { CrmStatus, type Company, type JwtUser } from '@bitcrm/types';
import { randomUUID } from 'crypto';
import { CompaniesRepository } from './companies.repository';
import { CompaniesCacheService } from './companies-cache.service';
import { type CreateCompanyDto } from './dto/create-company.dto';
import { type UpdateCompanyDto } from './dto/update-company.dto';

/**
 * Company numbers are best-effort: normalize what parses so the call log can
 * match it, keep anything else exactly as typed. Unlike a contact, a company
 * record often carries extensions or "ask for dispatch" style notes.
 */
function safePhone(raw: string): string {
  return tryNormalizePhone(raw) ?? raw;
}

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
    // Normalized on the way in so the call log can match the main line.
    // Unparseable entries are kept verbatim rather than rejected — a company
    // record is not a dialer, and people put extensions and notes in here.
    const phones = [...new Set((dto.phones || []).map(safePhone))];
    const company: Company = {
      id: randomUUID(),
      title: dto.title,
      phones,
      phoneExtensions: normalizePhoneExtensions(dto.phoneExtensions, phones),
      emails: dto.emails || [],
      address: dto.address,
      website: dto.website,
      clientType: dto.clientType,
      notes: dto.notes,
      status: CrmStatus.ACTIVE,
      isPlatinum: dto.isPlatinum,
      paymentTerms: dto.paymentTerms,
      customTermsDays: dto.customTermsDays,
      taxExempt: dto.taxExempt,
      poRequired: dto.poRequired,
      coiExpiration: dto.coiExpiration,
      createdBy: caller.id,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(company);
    await this.repository.syncPhoneIndex(company.id, [], company.phones);
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
    // Query params arrive as strings (no global ValidationPipe/transform), so
    // coerce to a number — DynamoDB's `Limit` rejects a string with a
    // SerializationException. Clamp to the DTO's intended 1..100 range.
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);

    if (query.clientType) {
      return this.repository.findByClientType(query.clientType, limit, query.cursor);
    }

    return this.repository.findAll(limit, query.cursor);
  }

  async findAll(limit: number, cursor?: string) {
    return this.repository.findAll(limit, cursor);
  }

  async update(id: string, dto: UpdateCompanyDto): Promise<Company> {
    const existing = await this.findById(id);

    const attrs: Partial<Company> & UpdateCompanyDto = { ...dto };
    if (dto.phones) {
      attrs.phones = [...new Set(dto.phones.map(safePhone))];
      await this.repository.syncPhoneIndex(id, existing.phones, attrs.phones);
    }
    // Re-keyed against the phones actually being saved, so an extension can
    // never outlive the number it belongs to — including when a caller sends
    // `phones` on its own and leaves the map to be worked out here.
    if (dto.phoneExtensions || attrs.phones) {
      attrs.phoneExtensions = normalizePhoneExtensions(
        dto.phoneExtensions ?? existing.phoneExtensions,
        attrs.phones ?? existing.phones,
      );
    }

    const updated = await this.repository.update(id, attrs);
    await this.cache.invalidate(id);
    this.businessMetrics?.entityUpdated.inc({ entity_type: 'company' });
    this.publishEvent('company.updated', { companyId: id });

    return updated;
  }

  async delete(id: string): Promise<void> {
    const existing = await this.findById(id);
    // Drop the index rows too, or the number keeps resolving to a company
    // nobody can open.
    await this.repository.syncPhoneIndex(id, existing.phones, []);
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
