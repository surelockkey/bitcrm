import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadGatewayException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import {
  SnsPublisherService,
  BusinessMetricsService,
  RedisService,
  cachedCount,
  countCacheKey,
} from '@bitcrm/shared';
import {
  ADDRESS_COUNTRY_PATTERN,
  ContactSource,
  ContactType,
  CrmStatus,
  isCustomFieldValueEmpty,
  isCustomFieldValueValid,
  type Address,
  type Company,
  type Contact,
  type CustomFieldValue,
  type JwtUser,
  type ListCount,
} from '@bitcrm/types';
import { randomUUID } from 'crypto';
import { ContactsRepository } from './contacts.repository';
import { CompaniesRepository } from '../companies/companies.repository';
import { ContactsCacheService } from './contacts-cache.service';
import { ContactNotesRepository } from './notes/contact-notes.repository';
import { ClientCustomFieldsCatalog } from './client-custom-fields.catalog';
import { type CreateContactDto } from './dto/create-contact.dto';
import { type UpdateContactDto } from './dto/update-contact.dto';
import { type FindOrCreateContactDto } from './dto/find-or-create-contact.dto';
import { type MergeContactsDto } from './dto/merge-contacts.dto';
import {
  normalizePhone,
  normalizePhones,
  phoneMatchVariants,
} from '../common/phone-normalization.util';
import { normalizePhoneExtensions } from '@bitcrm/shared';

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

/** How long a list count stays good enough. Matches the deals tab counts. */
const COUNT_TTL_SECONDS = 30;

/**
 * Distinct refs one `internal/by-ids` body may name. Callers send at most 200
 * (telephony's call log, messaging's party names); the headroom is so a
 * caller raising its page never breaks, the cap so nobody fans out unbounded
 * — crm runs no ValidationPipe, so the DTO's `ArrayMaxSize` is inert.
 */
export const MAX_PARTY_REFS = 500;

/** Distinct numbers one `internal/by-phones` body may name (callers send ≤ 100). */
export const MAX_PHONE_LOOKUPS = 500;

/** Pointer-row reads by-phones keeps in flight at once. */
const PHONE_LOOKUP_CONCURRENCY = 50;

/** Run `tasks` with at most `limit` in flight; rejects on the first failure. */
async function runBounded(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) await tasks[next++]();
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

/**
 * An address with its `country` as stored: ISO 3166-1 alpha-2, upper case,
 * or no key at all (= US) for a blank one. CRM runs no ValidationPipe, so
 * this is the check — anything else is a 400, never a stored "Canada".
 */
function withCountryCode<T extends Address | undefined | null>(address: T): T {
  if (!address || typeof address !== 'object' || !('country' in address)) return address;
  const { country, ...rest } = address as Address;
  if (country === undefined || country === null) return rest as T;
  const code = typeof country === 'string' ? country.trim().toUpperCase() : '';
  if (typeof country === 'string' && !code) return rest as T;
  if (!ADDRESS_COUNTRY_PATTERN.test(code)) {
    throw new BadRequestException('country must be an ISO 3166-1 alpha-2 code, e.g. US or CA');
  }
  return { ...rest, country: code } as T;
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
    @Optional() private readonly redis?: RedisService,
    // The client notes of a merged duplicate follow it to the survivor.
    @Optional() private readonly contactNotes?: ContactNotesRepository,
    // The client custom fields a contact's answers are checked against (deal-service's catalog).
    @Optional() private readonly clientFields?: ClientCustomFieldsCatalog,
  ) {}

  /**
   * A contact's client custom-field answers after `patch`: each key must name
   * an active CLIENT field and its value match the field's type (the deal's
   * rule for a job's answers); a blank or null answer clears its field.
   * Merged onto `stored`, so a card that sends one answer keeps the others —
   * and keeps keys this check never saw (an import's `workiz:f21`). The
   * catalog is asked afresh before a key is called unknown: a field made in
   * Settings a moment ago is not in the minute-old copy yet.
   */
  private async resolveCustomFields(
    patch: unknown,
    stored?: Record<string, CustomFieldValue>,
  ): Promise<Record<string, CustomFieldValue>> {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new BadRequestException('customFields must be an object keyed by custom field id');
    }
    const entries = Object.entries(patch as Record<string, unknown>);
    const merged: Record<string, CustomFieldValue> = { ...(stored ?? {}) };
    if (!entries.length) return merged;
    if (!this.clientFields) {
      throw new BadGatewayException('Client custom fields could not be read — try again');
    }

    const active = (list: Awaited<ReturnType<ClientCustomFieldsCatalog['list']>>) =>
      new Map(list.filter((d) => d.active).map((d) => [d.id, d] as const));
    let byId = active(await this.clientFields.list());
    if (entries.some(([id]) => !byId.has(id))) {
      byId = active(await this.clientFields.list({ fresh: true }));
    }

    for (const [id, value] of entries) {
      const def = byId.get(id);
      if (!def) throw new BadRequestException(`Unknown or inactive client custom field ${id}`);
      if (isCustomFieldValueEmpty(value)) {
        delete merged[id];
        continue;
      }
      if (!isCustomFieldValueValid(def.type, value, def.options ?? [])) {
        throw new BadRequestException(`Custom field "${def.name}" has an invalid value for type "${def.type}"`);
      }
      merged[id] = value as CustomFieldValue;
    }
    return merged;
  }

  /** Whether any contact still holds an answer for this client custom field (deal-service asks before a delete). */
  async isCustomFieldAnswered(fieldId: string): Promise<boolean> {
    return this.repository.isCustomFieldAnswered(fieldId);
  }

  /**
   * Shape-check the billing tax-exemption fields. CRM registers no global
   * ValidationPipe, so the DTO decorators are documentation only — without
   * this a string "false" would be stored and read back as truthy.
   * Returns the normalized pair (reason trimmed); absent fields stay absent.
   */
  private normalizeTaxExemption(dto: {
    taxExempt?: unknown;
    taxExemptReason?: unknown;
  }): { taxExempt?: boolean; taxExemptReason?: string } {
    const out: { taxExempt?: boolean; taxExemptReason?: string } = {};
    if (dto.taxExempt !== undefined) {
      if (typeof dto.taxExempt !== 'boolean') {
        throw new BadRequestException('taxExempt must be a boolean');
      }
      out.taxExempt = dto.taxExempt;
    }
    if (dto.taxExemptReason !== undefined && dto.taxExemptReason !== null) {
      if (typeof dto.taxExemptReason !== 'string') {
        throw new BadRequestException('taxExemptReason must be a string');
      }
      const reason = dto.taxExemptReason.trim();
      if (reason.length > 200) {
        throw new BadRequestException('taxExemptReason must be at most 200 characters');
      }
      out.taxExemptReason = reason;
    } else if (dto.taxExemptReason === null) {
      // The update builder only SETs, so "clear" is stored as an empty string.
      out.taxExemptReason = '';
    }
    return out;
  }

  async create(dto: CreateContactDto, caller: JwtUser): Promise<Contact> {
    const taxExemption = this.normalizeTaxExemption(dto);
    const customFields =
      dto.customFields === undefined || dto.customFields === null
        ? undefined
        : await this.resolveCustomFields(dto.customFields);
    const addresses = (dto.addresses || []).map((a) => withCountryCode(a));
    const billingAddress = withCountryCode(dto.billingAddress);

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
      phoneExtensions: normalizePhoneExtensions(dto.phoneExtensions, phones),
      emails: dto.emails || [],
      addresses,
      ...(billingAddress && { billingAddress }),
      ...(dto.tagIds && { tagIds: dto.tagIds }),
      ...(customFields && Object.keys(customFields).length > 0 && { customFields }),
      ...(dto.sourceId && { sourceId: dto.sourceId }),
      ...(dto.paymentTerms && { paymentTerms: dto.paymentTerms }),
      ...(dto.customTermsDays !== undefined && { customTermsDays: dto.customTermsDays }),
      companyId: dto.companyId,
      type: dto.type,
      title: dto.title,
      source: dto.source,
      notes: dto.notes,
      taxExempt: taxExemption.taxExempt ?? false,
      ...(taxExemption.taxExemptReason && { taxExemptReason: taxExemption.taxExemptReason }),
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

  /**
   * Read-through the per-contact cache. `fresh` skips the cache and reads the
   * table strongly consistent (and leaves the cache alone) — the search
   * indexer's read after `contact.updated`: a cached or eventually consistent
   * copy could predate the edit (a just-added second number) and index the
   * client without it.
   */
  async findById(id: string, opts: { fresh?: boolean } = {}): Promise<Contact> {
    if (opts.fresh) {
      const contact = await this.repository.findById(id, { consistent: true });
      if (!contact) throw new NotFoundException('Contact not found');
      return contact;
    }

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

  async list(query: { companyId?: string; limit?: number; cursor?: string; tagIds?: string }) {
    // Query params arrive as strings (no global ValidationPipe/transform), so
    // coerce to a number — DynamoDB's `Limit` rejects a string with a
    // SerializationException. Clamp to the DTO's intended 1..100 range.
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const tagIds = parseTagIds(query.tagIds);
    // Asked with the tags only when some are picked, so an untagged list reads as it always did.
    const filters = tagIds.length ? [{ tagIds }] : [];

    if (query.companyId) {
      return this.repository.findByCompany(query.companyId, limit, query.cursor, ...filters);
    }

    return this.repository.findActive(limit, query.cursor, ...filters);
  }

  async findAll(limit: number, cursor?: string) {
    return this.repository.findAll(limit, cursor);
  }

  /**
   * How many contacts the list holds — the number behind "Page 2 of 7".
   * It branches as `list` does, so the panel sizes itself against the rows
   * actually under it.
   */
  async count(query: { companyId?: string; tagIds?: string }): Promise<ListCount> {
    const tagIds = parseTagIds(query.tagIds);
    const filters = tagIds.length ? [{ tagIds }] : [];
    const take = () =>
      query.companyId
        ? this.repository.countByCompany(query.companyId, ...filters)
        : this.repository.countActive(...filters);

    if (!this.redis) return take();
    return cachedCount(
      this.redis.client,
      countCacheKey('contacts', {
        companyId: query.companyId,
        // Sorted: the same tags picked in another order are the same question.
        tags: tagIds.length ? [...tagIds].sort().join(',') : undefined,
      }),
      COUNT_TTL_SECONDS,
      take,
    );
  }

  async update(id: string, dto: UpdateContactDto): Promise<Contact> {
    const existing = await this.findById(id);
    const taxExemption = this.normalizeTaxExemption(dto);
    // Checked (and merged onto the stored answers) before anything is written.
    // The answers are read from the table, not the cache: a cached copy can
    // predate answers written elsewhere (an import patch), and the merged map
    // replaces the stored one whole.
    const customFields =
      dto.customFields === undefined
        ? undefined
        : await this.resolveCustomFields(
            dto.customFields ?? {},
            (await this.repository.findById(id))?.customFields ?? existing.customFields,
          );
    // Checked before anything is written (the phone index below writes).
    const addresses = dto.addresses?.map((a) => withCountryCode(a));
    const billingAddress = withCountryCode(dto.billingAddress);

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

    // The answers go in merged (below), never as sent.
    const { customFields: _sentAnswers, ...fields } = dto;
    const updateData: Partial<Contact> & Omit<UpdateContactDto, 'customFields'> = { ...fields, ...taxExemption };
    if (customFields) updateData.customFields = customFields;
    if (addresses) updateData.addresses = addresses;
    if (billingAddress) updateData.billingAddress = billingAddress;
    if (normalizedPhones) {
      updateData.phones = normalizedPhones;
    }
    // Re-keyed against the phones actually being saved, so an extension can
    // never outlive the number it belongs to — including when a caller sends
    // `phones` on its own and leaves the map to be worked out here.
    if (dto.phoneExtensions || normalizedPhones) {
      updateData.phoneExtensions = normalizePhoneExtensions(
        dto.phoneExtensions ?? existing.phoneExtensions,
        normalizedPhones ?? existing.phones,
      );
    }

    const updated = await this.repository.update(id, updateData);
    // Invalidate BEFORE publishing: consumers of `contact.updated` re-read the
    // contact and must never be answered the pre-edit copy.
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

    // The primary's own extension for a number wins; a duplicate only fills
    // in the numbers the primary had none for.
    const phoneExtensions = { ...primary.phoneExtensions };
    for (const dup of duplicates) {
      for (const [phone, extension] of Object.entries(dup.phoneExtensions ?? {})) {
        if (!phoneExtensions[phone]) phoneExtensions[phone] = extension;
      }
    }

    // The primary's answer to a client custom field wins; a duplicate only
    // answers the fields the primary left blank.
    const customFields: Record<string, CustomFieldValue> = { ...primary.customFields };
    for (const dup of duplicates) {
      for (const [fieldId, value] of Object.entries(dup.customFields ?? {})) {
        if (isCustomFieldValueEmpty(customFields[fieldId])) customFields[fieldId] = value;
      }
    }

    const updateAttrs: Partial<Contact> = {
      phones,
      phoneExtensions: normalizePhoneExtensions(phoneExtensions, phones),
      emails,
      addresses,
      ...(Object.keys(customFields).length > 0 && { customFields }),
    };
    if (notes) updateAttrs.notes = notes;
    if (companyId !== undefined) updateAttrs.companyId = companyId;

    const updated = await this.repository.update(primary.id, updateAttrs);

    for (const dup of duplicates) {
      // Notes first, soft-delete after: a move that fails leaves the duplicate
      // alive and mergeable again, instead of a deleted contact still holding
      // notes nobody can reach.
      await this.contactNotes?.moveAll(dup.id, primary.id);
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
    // crm runs no ValidationPipe, so the DTO's caps are documentation only.
    if (!Array.isArray(refs)) throw new BadRequestException('refs must be an array');
    const unique = new Map<string, { kind: 'contact' | 'company'; id: string }>();
    for (const r of refs) {
      // An empty or non-string id would fail the whole BatchGet, not just itself.
      if (!r || typeof r.id !== 'string' || !r.id) continue;
      unique.set(`${r.kind}:${r.id}`, r);
    }
    if (unique.size > MAX_PARTY_REFS) {
      throw new BadRequestException(`At most ${MAX_PARTY_REFS} distinct refs per request`);
    }

    const contactIds: string[] = [];
    const companyIds: string[] = [];
    for (const ref of unique.values()) {
      if (ref.kind === 'company') companyIds.push(ref.id);
      else contactIds.push(ref.id);
    }

    // One BatchGet per kind, in parallel. A failed read blanks its kind only —
    // a deleted or unreadable client shouldn't blank the whole page.
    const [contacts, companies] = await Promise.all([
      contactIds.length
        ? this.repository.findByIds(contactIds).catch((err) => {
            this.logger.warn(`by-ids: contact batch read failed: ${err?.message ?? err}`);
            return [] as Contact[];
          })
        : Promise.resolve([] as Contact[]),
      companyIds.length && this.companies
        ? this.companies.findByIds(companyIds).catch((err) => {
            this.logger.warn(`by-ids: company batch read failed: ${err?.message ?? err}`);
            return [] as Company[];
          })
        : Promise.resolve([] as Company[]),
    ]);
    const contactById = new Map(contacts.map((c) => [c.id, c]));
    const companyById = new Map(companies.map((c) => [c.id, c]));

    // Keys in the order asked, as before.
    const out: Record<string, { kind: string; id: string; name: string }> = {};
    for (const [key, ref] of unique) {
      if (ref.kind === 'company') {
        const company = companyById.get(ref.id);
        if (company) out[key] = { kind: ref.kind, id: ref.id, name: company.title };
        continue;
      }
      const contact = contactById.get(ref.id);
      if (contact) {
        out[key] = {
          kind: ref.kind,
          id: ref.id,
          name: `${contact.firstName} ${contact.lastName}`.trim(),
        };
      }
    }
    return out;
  }

  /**
   * The contacts a page of some list shows, in the order asked, duplicates
   * folded (`POST /contacts/by-ids`). Read-through the per-contact cache that
   * `findById` fills and every write invalidates: one MGET for the hits, the
   * misses in parallel BatchGets, then cached. A cache failure only costs the
   * cache. crm runs no ValidationPipe, so anything that is not a non-empty
   * string is dropped here — one such key would fail the whole BatchGet.
   */
  async findByIds(ids: string[]): Promise<Contact[]> {
    const unique = [
      ...new Set((Array.isArray(ids) ? ids : []).filter((id): id is string => typeof id === 'string' && id !== '')),
    ];
    if (unique.length === 0) return [];

    let found = new Map<string, Contact>();
    try {
      found = await this.cache.getMany(unique);
    } catch (err) {
      this.logger.warn(`Contact cache read failed (by-ids): ${(err as Error)?.message}`);
    }
    const misses = unique.filter((id) => !found.has(id));
    if (misses.length > 0) {
      const loaded = await this.repository.findByIds(misses);
      for (const c of loaded) found.set(c.id, c);
      if (loaded.length > 0) {
        try {
          await this.cache.setMany(loaded);
        } catch (err) {
          this.logger.warn(`Contact cache write failed (by-ids): ${(err as Error)?.message}`);
        }
      }
    }
    return unique.map((id) => found.get(id)).filter((c): c is Contact => Boolean(c));
  }

  async findManyByPhone(
    phones: string[],
  ): Promise<Record<string, ContactPhoneMatch>> {
    // crm runs no ValidationPipe, so the DTO's caps are documentation only.
    if (!Array.isArray(phones)) throw new BadRequestException('phones must be an array');

    // Grouped by canonical form, not by the raw string: `+14045551234` and
    // `(404) 555-1234` are one number and deserve one lookup. Each group
    // carries every form it might be stored under — records written before
    // normalization used libphonenumber can keep a national trunk prefix
    // (`+3800958601427`), which no longer matches what we'd derive now.
    const wanted = new Map<string, { raws: string[]; variants: string[] }>();
    for (const raw of new Set(phones)) {
      if (typeof raw !== 'string') continue;
      const variants = phoneMatchVariants(raw);
      if (!variants.length) continue;
      const group = wanted.get(variants[0]) ?? { raws: [], variants };
      group.raws.push(raw);
      wanted.set(variants[0], group);
    }
    if (wanted.size > MAX_PHONE_LOOKUPS) {
      throw new BadRequestException(`At most ${MAX_PHONE_LOOKUPS} distinct numbers per request`);
    }

    // Phase 1 — every pointer row of every variant, person and company, in
    // parallel (bounded). Phase 2 — one BatchGet per kind for what matched.
    const allVariants = [...new Set([...wanted.values()].flatMap((g) => g.variants))];
    const contactIdOf = new Map<string, string>();
    const companyIdOf = new Map<string, string>();
    const lookups: Array<() => Promise<void>> = [];
    for (const variant of allVariants) {
      lookups.push(async () => {
        const id = await this.repository.findIdByPhone(variant);
        if (id) contactIdOf.set(variant, id);
      });
      if (this.companies) {
        const companies = this.companies;
        lookups.push(async () => {
          const id = await companies.findIdByPhone(variant);
          if (id) companyIdOf.set(variant, id);
        });
      }
    }
    await runBounded(lookups, PHONE_LOOKUP_CONCURRENCY);

    const contactIds = [...new Set(contactIdOf.values())];
    const companyIds = [...new Set(companyIdOf.values())];
    const [contacts, companies] = await Promise.all([
      contactIds.length ? this.repository.findByIds(contactIds) : Promise.resolve([] as Contact[]),
      companyIds.length && this.companies
        ? this.companies.findByIds(companyIds)
        : Promise.resolve([] as Company[]),
    ]);
    const contactById = new Map(contacts.map((c) => [c.id, c]));
    const companyById = new Map(companies.map((c) => [c.id, c]));

    const out: Record<string, ContactPhoneMatch> = {};
    for (const { raws, variants } of wanted.values()) {
      let match: ContactPhoneMatch | null = null;
      // Same precedence as ever: variants in order, and within one variant a
      // person owns the number before a company does — reaching Jane on the
      // office line is still reaching Jane. A pointer whose row is gone
      // doesn't count.
      for (const variant of variants) {
        const contactId = contactIdOf.get(variant);
        const contact = contactId ? contactById.get(contactId) : undefined;
        if (contact) {
          match = {
            kind: 'contact',
            id: contact.id,
            firstName: contact.firstName,
            lastName: contact.lastName,
            companyId: contact.companyId,
          };
          break;
        }
        const companyId = companyIdOf.get(variant);
        const company = companyId ? companyById.get(companyId) : undefined;
        if (company) {
          match = {
            kind: 'company',
            id: company.id,
            firstName: company.title,
            lastName: '',
            companyId: company.id,
          };
          break;
        }
      }
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

/**
 * `?tagIds=a,b` → `['a', 'b']`: Workiz's "Filter results" TAGS, comma-separated
 * on the wire. Blank entries and repeats are dropped.
 */
export function parseTagIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(String(raw).split(',').map((t) => t.trim()).filter(Boolean))];
}
