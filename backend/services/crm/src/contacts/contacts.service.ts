import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { SnsPublisherService, BusinessMetricsService } from '@bitcrm/shared';
import { ContactSource, ContactType, CrmStatus, type Address, type Contact, type JwtUser } from '@bitcrm/types';
import { randomUUID } from 'crypto';
import { ContactsRepository } from './contacts.repository';
import { CompaniesRepository } from '../companies/companies.repository';
import { ContactsCacheService } from './contacts-cache.service';
import { type CreateContactDto } from './dto/create-contact.dto';
import { type UpdateContactDto } from './dto/update-contact.dto';
import { type FindOrCreateContactDto } from './dto/find-or-create-contact.dto';
import { type MergeContactsDto } from './dto/merge-contacts.dto';
import {
  normalizePhone,
  normalizePhones,
  phoneMatchVariants,
} from '../common/phone-normalization.util';

/**
 * What a phone lookup returns — enough to name the party and link to it.
 * `kind` distinguishes a person from a company main line, which live in
 * different tables and open different pages.
 */
export interface ContactPhoneMatch {
  kind: 'contact' | 'company';
  id: string;
  firstName: string;
  lastName: string;
  companyId?: string;
}

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    private readonly repository: ContactsRepository,
    private readonly cache: ContactsCacheService,
    // Optional so the many specs that construct this service directly keep
    // working; without it, company main lines simply don't resolve.
    @Optional() private readonly companies?: CompaniesRepository,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {}

  async create(dto: CreateContactDto, caller: JwtUser): Promise<Contact> {
    // De-duplicate: a repeated phone would write the same PHONE# index item
    // twice in one transaction, which DynamoDB rejects.
    const phones = [...new Set(normalizePhones(dto.phones))];

    // A number belongs to one contact. Normally a clash is a mistake and we
    // say so — but when somebody knowingly creates a new client from a call,
    // the number has genuinely changed hands (new tenant, new owner), and
    // `reassignPhones` moves it. Past calls keep pointing at whoever they
    // were actually with, because that link is frozen when a call ends.
    const takenFrom: Array<{ contact: Contact; phone: string }> = [];
    for (const phone of phones) {
      const existing = await this.repository.findByPhone(phone);
      if (!existing) continue;
      if (!dto.reassignPhones) {
        throw new ConflictException(
          `Contact with phone ${phone} already exists (id: ${existing.id})`,
        );
      }
      takenFrom.push({ contact: existing, phone });
    }

    const now = new Date().toISOString();
    const contact: Contact = {
      id: randomUUID(),
      firstName: dto.firstName,
      lastName: dto.lastName,
      phones,
      emails: dto.emails || [],
      addresses: dto.addresses || [],
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

    // Take the numbers off their previous owner first, so the index never
    // points at two contacts for the same number.
    for (const { contact: previous, phone } of takenFrom) {
      const remaining = previous.phones.filter((p) => p !== phone);
      await this.repository.updatePhoneIndex(
        previous.id,
        previous.phones,
        remaining,
      );
      await this.repository.update(previous.id, { phones: remaining });
      await this.cache.invalidate(previous.id);
      this.logger.log(
        `Phone ${phone} reassigned from contact ${previous.id} to ${contact.id}`,
      );
    }

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
    // Query params arrive as strings (no global ValidationPipe/transform), so
    // coerce to a number — DynamoDB's `Limit` rejects a string with a
    // SerializationException. Clamp to the DTO's intended 1..100 range.
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);

    if (query.companyId) {
      return this.repository.findByCompany(query.companyId, limit, query.cursor);
    }

    return this.repository.findAll(limit, query.cursor);
  }

  async findAll(limit: number, cursor?: string) {
    return this.repository.findAll(limit, cursor);
  }

  async update(id: string, dto: UpdateContactDto): Promise<Contact> {
    const existing = await this.findById(id);

    let normalizedPhones: string[] | undefined;
    if (dto.phones) {
      // De-duplicate: a repeated phone would otherwise write the same PHONE#
      // index item twice in one transaction.
      normalizedPhones = [...new Set(normalizePhones(dto.phones))];

      // Reject a newly-added phone that already belongs to a different contact
      // (parity with create). Phones the contact already had are skipped.
      const added = normalizedPhones.filter((p) => !existing.phones.includes(p));
      for (const phone of added) {
        const owner = await this.repository.findByPhone(phone);
        if (owner && owner.id !== id) {
          throw new ConflictException(
            `Contact with phone ${phone} already exists (id: ${owner.id})`,
          );
        }
      }

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

  async merge(dto: MergeContactsDto): Promise<Contact> {
    const mergeIds = [...new Set(dto.mergeIds)];
    if (mergeIds.includes(dto.primaryId)) {
      throw new BadRequestException('primaryId cannot appear in mergeIds');
    }

    const primary = await this.requireMergeableContact(dto.primaryId);
    const duplicates: Contact[] = [];
    for (const id of mergeIds) {
      duplicates.push(await this.requireMergeableContact(id));
    }

    const phones = [...primary.phones];
    for (const dup of duplicates) {
      for (const phone of dup.phones) {
        if (!phones.includes(phone)) phones.push(phone);
      }
    }

    const emails = [...primary.emails];
    const seenEmails = new Set(emails.map((e) => e.toLowerCase()));
    for (const dup of duplicates) {
      for (const email of dup.emails) {
        const key = email.toLowerCase();
        if (!seenEmails.has(key)) {
          seenEmails.add(key);
          emails.push(email);
        }
      }
    }

    const addresses = [...primary.addresses];
    const seenAddresses = new Set(addresses.map(this.addressKey));
    for (const dup of duplicates) {
      for (const address of dup.addresses) {
        const key = this.addressKey(address);
        if (!seenAddresses.has(key)) {
          seenAddresses.add(key);
          addresses.push(address);
        }
      }
    }

    const notes = [primary, ...duplicates]
      .map((c) => c.notes?.trim())
      .filter(Boolean)
      .join('\n\n');
    const companyId =
      primary.companyId ?? duplicates.find((d) => d.companyId)?.companyId;

    // Drop the losers' PHONE# rows before the primary claims the numbers:
    // findByPhone queries by PK only, so a leftover row would keep resolving
    // the number to a soft-deleted contact.
    for (const dup of duplicates) {
      await this.repository.updatePhoneIndex(dup.id, dup.phones, []);
    }
    await this.repository.updatePhoneIndex(primary.id, primary.phones, phones);

    const updateAttrs: Partial<Contact> = { phones, emails, addresses };
    if (notes) updateAttrs.notes = notes;
    if (companyId !== undefined) updateAttrs.companyId = companyId;

    const updated = await this.repository.update(primary.id, updateAttrs);

    for (const dup of duplicates) {
      await this.repository.update(dup.id, { status: CrmStatus.DELETED } as any);
      await this.cache.invalidate(dup.id);
      this.businessMetrics?.entityDeleted.inc({ entity_type: 'contact' });
      this.publishEvent('contact.merged', {
        oldContactId: dup.id,
        newContactId: primary.id,
      });
    }

    await this.cache.invalidate(primary.id);
    this.businessMetrics?.entityUpdated.inc({ entity_type: 'contact' });
    this.publishEvent('contact.updated', { contactId: primary.id });

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

  /**
   * Resolve many phone numbers to their contacts in one round trip — the call
   * log needs a name per number and would otherwise issue one request per row.
   * Keyed by the caller's original string so it can map results back without
   * re-normalizing. Unparseable numbers and misses are simply absent: a number
   * nobody owns is the normal case here, not an error.
   */
  /**
   * Names for parties a call was already associated with. The call log stores
   * only the id, so this is what turns a frozen association back into
   * something readable — and why renaming a client updates old calls.
   */
  async findManyByRef(
    refs: Array<{ kind: 'contact' | 'company'; id: string }>,
  ): Promise<Record<string, { kind: string; id: string; name: string }>> {
    const unique = new Map(refs.map((r) => [`${r.kind}:${r.id}`, r]));

    const found = await Promise.all(
      [...unique.entries()].map(async ([key, ref]) => {
        try {
          if (ref.kind === 'company') {
            const company = await this.companies?.findById(ref.id);
            return company
              ? { key, value: { kind: ref.kind, id: ref.id, name: company.title } }
              : null;
          }
          const contact = await this.repository.findById(ref.id);
          return contact
            ? {
                key,
                value: {
                  kind: ref.kind,
                  id: ref.id,
                  name: `${contact.firstName} ${contact.lastName}`.trim(),
                },
              }
            : null;
        } catch {
          // A deleted client shouldn't blank the whole page.
          return null;
        }
      }),
    );

    const out: Record<string, { kind: string; id: string; name: string }> = {};
    for (const entry of found) {
      if (entry) out[entry.key] = entry.value;
    }
    return out;
  }

  async findManyByPhone(
    phones: string[],
  ): Promise<Record<string, ContactPhoneMatch>> {
    // Grouped by canonical form, not by the raw string: `+14045551234` and
    // `(404) 555-1234` are one number and deserve one lookup. Each group
    // carries every form it might be stored under — records written before
    // normalization used libphonenumber can keep a national trunk prefix
    // (`+3800958601427`), which no longer matches what we'd derive now.
    const wanted = new Map<string, { raws: string[]; variants: string[] }>();
    for (const raw of new Set(phones)) {
      const variants = phoneMatchVariants(raw);
      if (!variants.length) continue;
      const group = wanted.get(variants[0]) ?? { raws: [], variants };
      group.raws.push(raw);
      wanted.set(variants[0], group);
    }

    const found = await Promise.all(
      [...wanted.values()].map(async ({ raws, variants }) => {
        for (const variant of variants) {
          // A person owns the number before a company does: reaching Jane on
          // the office line is still reaching Jane.
          const contact = await this.repository.findByPhone(variant);
          if (contact) {
            return {
              raws,
              variants,
              match: {
                kind: 'contact' as const,
                id: contact.id,
                firstName: contact.firstName,
                lastName: contact.lastName,
                companyId: contact.companyId,
              },
            };
          }
          const company = await this.companies?.findByPhone(variant);
          if (company) {
            return {
              raws,
              variants,
              match: {
                kind: 'company' as const,
                id: company.id,
                firstName: company.title,
                lastName: '',
                companyId: company.id,
              },
            };
          }
        }
        return { raws, variants, match: null };
      }),
    );

    const out: Record<string, ContactPhoneMatch> = {};
    for (const { raws, variants, match } of found) {
      if (!match) continue;
      // Keyed by what each caller sent and by the canonical form, so either
      // side of the lookup can find it again.
      for (const raw of raws) out[raw] = match;
      out[variants[0]] = match;
    }
    return out;
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
      addresses: [],
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

  private async requireMergeableContact(id: string): Promise<Contact> {
    const contact = await this.repository.findById(id);
    if (!contact) throw new NotFoundException(`Contact ${id} not found`);
    if (contact.status === CrmStatus.DELETED) {
      throw new BadRequestException(`Contact ${id} is deleted and cannot be merged`);
    }
    return contact;
  }

  private addressKey(address: Address): string {
    const norm = (v?: string) => (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    return [address.street, address.unit, address.city, address.state, address.zip]
      .map(norm)
      .join('|');
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
