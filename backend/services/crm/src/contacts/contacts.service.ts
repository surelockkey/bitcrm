import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { SnsPublisherService, BusinessMetricsService } from '@bitcrm/shared';
import { ContactSource, ContactType, CrmStatus, type Contact, type JwtUser } from '@bitcrm/types';
import { randomUUID } from 'crypto';
import { ContactsRepository } from './contacts.repository';
import { ContactsCacheService } from './contacts-cache.service';
import { type CreateContactDto } from './dto/create-contact.dto';
import { type UpdateContactDto } from './dto/update-contact.dto';
import { type FindOrCreateContactDto } from './dto/find-or-create-contact.dto';
import { normalizePhone, normalizePhones } from '../common/phone-normalization.util';

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    private readonly repository: ContactsRepository,
    private readonly cache: ContactsCacheService,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {}

  async create(dto: CreateContactDto, caller: JwtUser): Promise<Contact> {
    const phones = normalizePhones(dto.phones);

    for (const phone of phones) {
      const existing = await this.repository.findByPhone(phone);
      if (existing) {
        throw new ConflictException(
          `Contact with phone ${phone} already exists (id: ${existing.id})`,
        );
      }
    }

    const now = new Date().toISOString();
    const contact: Contact = {
      id: randomUUID(),
      firstName: dto.firstName,
      lastName: dto.lastName,
      phones,
      emails: dto.emails || [],
      companyId: dto.companyId,
      type: dto.type,
      title: dto.title,
      source: dto.source,
      notes: dto.notes,
      status: CrmStatus.ACTIVE,
      createdBy: caller.id,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(contact);
    this.businessMetrics?.entityCreated.inc({ entity_type: 'contact' });
    this.publishEvent('contact.created', { contactId: contact.id, firstName: contact.firstName, lastName: contact.lastName });

    return contact;
  }

  async findById(id: string): Promise<Contact> {
    const cached = await this.cache.get(id);
    if (cached) {
      this.businessMetrics?.cacheHits.inc({ entity_type: 'contact' });
      return cached;
    }

    this.businessMetrics?.cacheMisses.inc({ entity_type: 'contact' });
    const contact = await this.repository.findById(id);
    if (!contact) throw new NotFoundException('Contact not found');

    await this.cache.set(contact);
    return contact;
  }

  async list(query: { companyId?: string; limit?: number; cursor?: string }) {
    const limit = query.limit || 20;

    if (query.companyId) {
      return this.repository.findByCompany(query.companyId, limit, query.cursor);
    }

    return this.repository.findAll(limit, query.cursor);
  }

  async update(id: string, dto: UpdateContactDto): Promise<Contact> {
    const existing = await this.findById(id);

    let normalizedPhones: string[] | undefined;
    if (dto.phones) {
      normalizedPhones = normalizePhones(dto.phones);
      await this.repository.updatePhoneIndex(id, existing.phones, normalizedPhones);
    }

    const updateData = { ...dto };
    if (normalizedPhones) {
      updateData.phones = normalizedPhones;
    }

    const updated = await this.repository.update(id, updateData);
    await this.cache.invalidate(id);
    this.businessMetrics?.entityUpdated.inc({ entity_type: 'contact' });
    this.publishEvent('contact.updated', { contactId: id });

    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.findById(id);
    await this.repository.update(id, { status: CrmStatus.DELETED } as any);
    await this.cache.invalidate(id);
    this.businessMetrics?.entityDeleted.inc({ entity_type: 'contact' });
  }

  async searchByPhone(phone: string): Promise<Contact | null> {
    const normalized = normalizePhone(phone);
    return this.repository.findByPhone(normalized);
  }

  async findOrCreate(dto: FindOrCreateContactDto): Promise<{ contact: Contact; created: boolean }> {
    const normalized = normalizePhone(dto.phone);
    const existing = await this.repository.findByPhone(normalized);

    if (existing) {
      return { contact: existing, created: false };
    }

    const now = new Date().toISOString();
    const contact: Contact = {
      id: randomUUID(),
      firstName: dto.firstName || 'Unknown',
      lastName: dto.lastName || 'Unknown',
      phones: [normalized],
      emails: [],
      type: ContactType.RESIDENTIAL,
      source: dto.source || ContactSource.PHONE_CALL,
      status: CrmStatus.ACTIVE,
      createdBy: 'system',
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(contact);
    this.publishEvent('contact.created', { contactId: contact.id, firstName: contact.firstName, lastName: contact.lastName });

    return { contact, created: true };
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
