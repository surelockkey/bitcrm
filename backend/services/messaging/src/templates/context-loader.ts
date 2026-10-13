import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { clientConfirmUrl } from '@bitcrm/shared';
import type { Address, CustomFieldValue, MessagingSettings } from '@bitcrm/types';
import { ConversationsRepository } from '../conversations/conversations.repository';
import { MessagingSettingsRepository } from '../settings/messaging-settings.repository';
import { isValidTimezone, jobZone, resolveTimezone } from './date-format';
import type { RenderContact, RenderContext, RenderDeal, RenderPerson, RenderRefs } from './render-context';

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:4001';
const CRM_SERVICE_URL = process.env.CRM_SERVICE_URL || 'http://localhost:4002';
const DEAL_SERVICE_URL = process.env.DEAL_SERVICE_URL || 'http://localhost:4003';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

/** Catalogs (job types, sources, external companies, custom fields) change rarely. */
const CATALOG_TTL_MS = 60_000;

/** Injection token for a `fetch` replacement — tests only; production uses the global. */
export const CONTEXT_FETCH = 'MESSAGING_CONTEXT_FETCH';
export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

interface CatalogRow {
  id: string;
  name: string;
  active?: boolean;
  /** Service areas only: the area's IANA zone. */
  timezone?: string;
}
export interface CustomFieldRow extends CatalogRow {
  type?: string;
  /** `client` = a client custom field (answered on the contact); absent = a job field. */
  entityType?: string;
}

/**
 * Builds a `RenderContext` from ids, the way telephony's `DealReadService` /
 * `ContactLookupService` read their peers: raw `fetch` against the internal
 * routes with `x-internal-secret`. Every lookup is best effort — a peer that
 * is down yields a partial context and the affected codes come back in
 * `missing`; rendering never fails because CRM is slow.
 *
 * Internal endpoints used (all exist today):
 *   deal  GET /api/deals/internal/:id                  the job
 *         GET /api/deals/custom-fields/internal        definitions (id → name) for `{{<custom field>}}`
 *         GET /api/deals/job-types/internal            `{{job_type}}`
 *         GET /api/deals/job-sources/internal          `{{ad_group}}`
 *         GET /api/deals/external-companies/internal   `{{referral_company_name}}`
 *         GET /api/deals/service-areas/internal        the job's area zone, when the job has none of its own
 *   crm   GET /api/crm/contacts/internal/:id           the party
 *         GET /api/crm/companies/internal/:id          `{{company_name}}`
 *   user  GET /api/users/internal/:id                  `{{tech_assigned}}`, `{{tech_phone}}`, team-chat party
 *
 * TODO(M11): nothing serves the business profile (`{{biz_*}}`) or the link
 * base URLs — they are messaging settings.
 *
 * The zone (owner, 2026-10-12): a job's times are told on the JOB's clock —
 * `jobTimezone`, else its service area's, else Connecticut. The company
 * setting is only for a message with no job.
 */
@Injectable()
export class ContextLoader {
  private readonly logger = new Logger(ContextLoader.name);
  private readonly catalogs = new Map<string, { rows: CatalogRow[]; expiresAt: number }>();
  /** Catalog reads in flight, so concurrent misses share one request. */
  private readonly catalogFlights = new Map<string, Promise<CatalogRow[]>>();

  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly settingsRepository: MessagingSettingsRepository,
    @Optional() @Inject(CONTEXT_FETCH) private readonly fetchImpl?: FetchLike,
  ) {}

  async load(refs: RenderRefs): Promise<RenderContext> {
    const settings = (await this.settingsRepository.get().catch((err) => {
      this.logger.warn(`settings unavailable: ${(err as Error).message}`);
      return null;
    })) ?? undefined;

    let { contactId, dealId, userId } = refs;
    let companyId: string | undefined;
    let partyUserId: string | undefined;

    if (refs.conversationId) {
      const conversation = await this.conversations.get(refs.conversationId).catch(() => null);
      if (conversation) {
        if (conversation.partyKind === 'contact') contactId ??= conversation.partyId;
        else if (conversation.partyKind === 'company') companyId = conversation.partyId;
        else if (conversation.partyKind === 'user') partyUserId = conversation.partyId;
        dealId ??= conversation.lastDealId;
      }
    }

    const deal = dealId ? await this.loadDeal(dealId) : undefined;
    contactId ??= deal?.contactId;
    companyId ??= deal?.companyId;

    const contact = contactId ? await this.loadContact(contactId) : undefined;
    companyId ??= contact?.companyId;
    const company = companyId ? await this.loadCompany(companyId) : undefined;

    // Team chat: the party is a user, not a CRM contact.
    const partyUser = !contact && partyUserId ? await this.loadUser(partyUserId) : undefined;

    const technicianId = this.pickTechnician(deal, userId);
    const technician = technicianId ? await this.loadUser(technicianId) : undefined;

    const customFields = deal?.customFields ? await this.nameCustomFields(deal.customFields) : undefined;

    const timezone = deal
      ? await this.jobTimezone(deal)
      : resolveTimezone(settings?.timezone ?? settings?.quietHours?.timezone);

    // The job's signed confirm page (B12): computed here from the shared secret
    // and the portal origin — billing verifies the same token; no call per text.
    const confirmLink = deal?.id ? clientConfirmUrl(deal.id) : undefined;

    return {
      contact:
        contact ??
        (partyUser
          ? { firstName: partyUser.firstName, lastName: partyUser.lastName, phones: partyUser.phone ? [partyUser.phone] : [], emails: partyUser.email ? [partyUser.email] : [] }
          : undefined),
      deal,
      technician,
      company,
      customFields,
      settings: settings as MessagingSettings | undefined,
      values: refs.values,
      timezone,
      call: refs.call,
      ...(confirmLink && { confirmLink }),
    };
  }

  /**
   * Definitions for the short-code picker: active JOB custom fields, by name —
   * a code resolves from the job's answers, and a client field's answers are
   * on the contact.
   */
  async listCustomFields(): Promise<CustomFieldRow[]> {
    const rows = (await this.catalog('custom-fields')) as CustomFieldRow[];
    return rows.filter((r) => r.active !== false && r.entityType !== 'client');
  }

  /**
   * The job's own zone: its `jobTimezone`, else its service area's (the
   * cached area list — read only when the job has no zone of its own), else
   * Connecticut. An unreadable area list is never fatal.
   */
  private async jobTimezone(deal: RenderDeal): Promise<string> {
    if (deal.jobTimezone && isValidTimezone(deal.jobTimezone)) return deal.jobTimezone;
    const area = deal.serviceAreaId
      ? (await this.catalog('service-areas')).find((row) => row.id === deal.serviceAreaId)
      : undefined;
    return jobZone(deal.jobTimezone, area?.timezone);
  }

  /** The sender when they are on the roster, else the first assigned tech; without a job, the sender. */
  private pickTechnician(deal: RenderDeal | undefined, userId?: string): string | undefined {
    if (!deal) return userId;
    const roster = deal.assignedTechIds ?? [];
    if (userId && roster.includes(userId)) return userId;
    return roster[0];
  }

  private async loadDeal(id: string): Promise<RenderDeal | undefined> {
    const raw = await this.fetchJson<Record<string, unknown>>(
      `${DEAL_SERVICE_URL}/api/deals/internal/${encodeURIComponent(id)}`,
    );
    if (!raw) return undefined;
    const deal: RenderDeal = {
      id: raw.id as string,
      dealNumber: raw.dealNumber as string | undefined,
      contactId: raw.contactId as string | undefined,
      companyId: raw.companyId as string | undefined,
      scheduledDate: raw.scheduledDate as string | undefined,
      scheduledEndDate: raw.scheduledEndDate as string | undefined,
      scheduledTimeSlot: raw.scheduledTimeSlot as string | undefined,
      allDay: raw.allDay as boolean | undefined,
      address: raw.address as Address | undefined,
      notes: raw.notes as string | undefined,
      jobTypeId: raw.jobTypeId as string | undefined,
      sourceId: raw.sourceId as string | undefined,
      externalCompanyId: raw.externalCompanyId as string | undefined,
      assignedTechIds: (raw.assignedTechIds as string[] | undefined) ?? [],
      clientName: raw.clientName as RenderDeal['clientName'],
      customFields: raw.customFields as Record<string, CustomFieldValue> | undefined,
      jobTimezone: raw.jobTimezone as string | undefined,
      serviceAreaId: raw.serviceAreaId as string | undefined,
    };
    const [jobTypeName, jobSourceName, externalCompanyName] = await Promise.all([
      deal.jobTypeId ? this.catalogName('job-types', deal.jobTypeId) : undefined,
      deal.sourceId ? this.catalogName('job-sources', deal.sourceId) : undefined,
      deal.externalCompanyId ? this.catalogName('external-companies', deal.externalCompanyId) : undefined,
    ]);
    return { ...deal, jobTypeName, jobSourceName, externalCompanyName };
  }

  private async loadContact(id: string): Promise<RenderContact | undefined> {
    const raw = await this.fetchJson<RenderContact>(
      `${CRM_SERVICE_URL}/api/crm/contacts/internal/${encodeURIComponent(id)}`,
    );
    return raw
      ? { firstName: raw.firstName, lastName: raw.lastName, phones: raw.phones ?? [], emails: raw.emails ?? [], addresses: raw.addresses ?? [], companyId: raw.companyId }
      : undefined;
  }

  private async loadCompany(id: string): Promise<RenderContext['company']> {
    const raw = await this.fetchJson<{ title?: string; phones?: string[]; emails?: string[]; address?: string }>(
      `${CRM_SERVICE_URL}/api/crm/companies/internal/${encodeURIComponent(id)}`,
    );
    return raw ? { title: raw.title, phones: raw.phones ?? [], emails: raw.emails ?? [], address: raw.address } : undefined;
  }

  private async loadUser(id: string): Promise<RenderPerson | undefined> {
    const raw = await this.fetchJson<RenderPerson>(`${USER_SERVICE_URL}/api/users/internal/${encodeURIComponent(id)}`);
    return raw ? { firstName: raw.firstName, lastName: raw.lastName, phone: raw.phone, email: raw.email } : undefined;
  }

  /** `{ <definition id>: value }` → `{ <definition name>: value }`; unknown ids are dropped. */
  private async nameCustomFields(
    byId: Record<string, CustomFieldValue>,
  ): Promise<Record<string, CustomFieldValue> | undefined> {
    if (Object.keys(byId).length === 0) return undefined;
    const definitions = await this.catalog('custom-fields');
    const out: Record<string, CustomFieldValue> = {};
    for (const definition of definitions) {
      if (definition.id in byId) out[definition.name] = byId[definition.id];
    }
    return out;
  }

  private async catalogName(kind: string, id: string): Promise<string | undefined> {
    return (await this.catalog(kind)).find((row) => row.id === id)?.name;
  }

  /**
   * A deal-service catalog, cached `CATALOG_TTL_MS`. Any successful answer is
   * cached — an EMPTY list too: a workspace with no custom fields would
   * otherwise ask deal-service on every text. A failure is not cached (the
   * stale rows, or `[]`, answer meanwhile). Single-flight: misses that arrive
   * while a read is in flight wait for it.
   */
  private async catalog(kind: string): Promise<CatalogRow[]> {
    const hit = this.catalogs.get(kind);
    if (hit && hit.expiresAt > Date.now()) return hit.rows;
    const pending = this.catalogFlights.get(kind);
    if (pending) return pending;
    const flight = (async () => {
      try {
        const rows = await this.fetchJson<CatalogRow[]>(`${DEAL_SERVICE_URL}/api/deals/${kind}/internal`);
        if (!Array.isArray(rows)) return this.catalogs.get(kind)?.rows ?? [];
        this.catalogs.set(kind, { rows, expiresAt: Date.now() + CATALOG_TTL_MS });
        return rows;
      } finally {
        this.catalogFlights.delete(kind);
      }
    })();
    this.catalogFlights.set(kind, flight);
    return flight;
  }

  /** `data` of the envelope, or `undefined` on any failure (logged, never thrown). */
  private async fetchJson<T>(url: string): Promise<T | undefined> {
    try {
      const doFetch = this.fetchImpl ?? (fetch as unknown as FetchLike);
      const res = await doFetch(url, { headers: { 'x-internal-secret': INTERNAL_SECRET } });
      if (!res.ok) {
        if (res.status !== 404) this.logger.warn(`${url} returned ${res.status}`);
        return undefined;
      }
      const body = (await res.json()) as { data?: T };
      return body?.data;
    } catch (err) {
      this.logger.warn(`${url} failed: ${err instanceof Error ? err.message : err}`);
      return undefined;
    }
  }
}
