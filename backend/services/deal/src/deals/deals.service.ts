import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  UnprocessableEntityException,
  Optional,
} from '@nestjs/common';
import {
  SnsPublisherService,
  BusinessMetricsService,
  GeocodingService,
  formatAddress,
} from '@bitcrm/shared';
import {
  JobSuperStatus,
  TERMINAL_SUPER_STATUSES,
  CLOSED_SUPER_STATUSES,
  DataScope,
  DealStatus,
  DealPriority,
  TimelineEventType,
  ProductType,
  type Address,
  type Deal,
  type ServiceArea,
  type DealProductFulfillment,
  type Product,
  type TimelineEntry,
  type JwtUser,
  type CustomFieldDefinition,
  type CustomFieldValue,
  type CustomFieldType,
  type DealSentToTechEvent,
  DealEventType,
} from '@bitcrm/types';
import { randomUUID } from 'crypto';
import { DealsRepository, type DealFilters, type DealUpdate } from './deals.repository';
import { type SendToTechDto } from './dto/send-to-tech.dto';
import { type RecordSentToTechDto } from './dto/record-sent-to-tech.dto';
import { isDealNumberCode } from './deal-number.util';
import { DealsCacheService } from './deals-cache.service';
import { TimelineRepository } from '../timeline/timeline.repository';
import { DealProductsRepository } from '../products/deal-products.repository';
import { InternalHttpService } from '../common/services/internal-http.service';
import { ServiceAreasService } from '../service-areas/service-areas.service';
import { JobTypesService } from '../job-types/job-types.service';
import { JobSourcesService } from '../job-sources/job-sources.service';
import { ExternalCompaniesService } from '../external-companies/external-companies.service';
import { JobTagsService } from '../job-tags/job-tags.service';
import { JobStatusesService } from '../job-statuses/job-statuses.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { TechnicianEligibilityRepository } from '../technician-eligibility/technician-eligibility.repository';
import { distanceMiles } from '../common/utils/haversine';
import { type CreateDealDto } from './dto/create-deal.dto';
import { type UpdateDealDto } from './dto/update-deal.dto';
import { type MoveStatusDto } from './dto/move-status.dto';
import { type ListDealsQueryDto } from './dto/list-deals-query.dto';
import { type AddNoteDto } from './dto/add-note.dto';
import { type UpdateNoteDto } from './dto/update-note.dto';
import { JobFieldSettingsService } from '../job-field-settings/job-field-settings.service';
import { type AddDealProductDto } from './dto/add-deal-product.dto';
import { type UpdatePaymentStatusDto } from './dto/update-payment-status.dto';
import { DealTaxResolver, type DealTaxSnapshot } from './billing/deal-tax.resolver';
import { BusinessProfilesClient } from '../common/services/business-profiles.client';

/** Tax snapshot fields: written by resolution, never diffed as plain field edits. */
const TAX_KEYS = new Set(['taxSource', 'taxRateId', 'taxRateName', 'taxRatePercent']);
/** Company fields: one FIELD_UPDATED entry (with names) instead of two raw diffs. */
const COMPANY_KEYS = new Set(['businessProfileId', 'businessProfileName']);

interface CompanyRef {
  id: string;
  name?: string;
}

@Injectable()
export class DealsService {
  private readonly logger = new Logger(DealsService.name);

  constructor(
    private readonly repository: DealsRepository,
    private readonly cache: DealsCacheService,
    private readonly timelineRepo: TimelineRepository,
    private readonly productsRepo: DealProductsRepository,
    private readonly internalHttp: InternalHttpService,
    private readonly geocoding: GeocodingService,
    private readonly serviceAreas: ServiceAreasService,
    private readonly jobTypes: JobTypesService,
    private readonly jobSources: JobSourcesService,
    private readonly externalCompanies: ExternalCompaniesService,
    private readonly jobTags: JobTagsService,
    private readonly jobStatuses: JobStatusesService,
    private readonly customFields: CustomFieldsService,
    private readonly eligibility: TechnicianEligibilityRepository,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
    @Optional() private readonly jobFieldSettings?: JobFieldSettingsService,
    @Optional() private readonly taxResolver?: DealTaxResolver,
    @Optional() private readonly businessProfiles?: BusinessProfilesClient,
  ) {}

  /**
   * Attach coordinates to an address so the deal can be plotted on the dispatch
   * map and ranked by distance in `getQualifiedTechs`.
   *
   * DynamoDB writes `address` as one whole map, so any sub-key the caller omits
   * is destroyed. That is how coordinates used to vanish: the edit form re-sends
   * the address without lat/lng and the stored ones were overwritten. Hence the
   * carry-over below — an unchanged address keeps the coordinates it already had
   * rather than paying to geocode the same string again.
   */
  private async resolveAddress(
    incoming: Address,
    previous?: Address,
  ): Promise<Address> {
    const address = { ...incoming };

    if (address.lat !== undefined && address.lng !== undefined) {
      return address;
    }

    if (
      previous?.lat !== undefined &&
      previous?.lng !== undefined &&
      formatAddress(previous) === formatAddress(address)
    ) {
      return { ...address, lat: previous.lat, lng: previous.lng };
    }

    const coords = await this.geocoding.geocode(address);
    return coords ? { ...address, ...coords } : address;
  }

  /**
   * Resolve the catalog service area covering a geocoded address. Returns the
   * matched area's id + name; falls back to the caller-supplied label (or '')
   * when the address is uncoordinated or outside every area.
   */
  private async resolveServiceArea(
    address: Address,
    fallbackLabel?: string,
  ): Promise<{ serviceAreaId?: string; serviceArea: string; area?: ServiceArea }> {
    if (address.lat === undefined || address.lng === undefined) {
      return { serviceArea: fallbackLabel ?? '' };
    }
    const area = await this.serviceAreas.resolvePoint({
      lat: address.lat,
      lng: address.lng,
    });
    if (!area) {
      this.logger.log(`No service area covers deal address; leaving unassigned`);
      return { serviceArea: fallbackLabel ?? '' };
    }
    return { serviceAreaId: area.id, serviceArea: area.name, area };
  }

  /** A manually chosen area: must exist; archived ones may not take new jobs. */
  private async pickServiceArea(
    id: string,
  ): Promise<{ serviceAreaId: string; serviceArea: string; area: ServiceArea }> {
    const area = await this.serviceAreas.findById(id);
    if (!area.active) {
      throw new BadRequestException(
        `Service area "${area.name}" is archived and cannot be used on a new deal`,
      );
    }
    return { serviceAreaId: area.id, serviceArea: area.name, area };
  }

  /**
   * The company a new job starts with: the one asked for (must be active) →
   * the service area's default company (skipped if it is gone/archived) →
   * billing's default company → none. Billing being unreachable never fails
   * the create — an id is then accepted without a snapshot name.
   */
  private async companyForCreate(
    requested: string | null | undefined,
    area?: ServiceArea,
  ): Promise<CompanyRef | undefined> {
    const explicit = requested?.trim();
    if (explicit) {
      return this.businessProfiles ? this.businessProfiles.resolve(explicit) : { id: explicit };
    }
    if (!this.businessProfiles) return undefined;
    if (area?.defaultBusinessProfileId) {
      try {
        return await this.businessProfiles.resolve(area.defaultBusinessProfileId);
      } catch (err) {
        this.logger.warn(
          `Service area ${area.id} default company ${area.defaultBusinessProfileId} unusable: ${(err as Error).message}`,
        );
      }
    }
    const fallback = await this.businessProfiles.findDefault();
    return fallback ? { id: fallback.id, name: fallback.name } : undefined;
  }

  /** An answer counts as "not filled" when it is absent, blank, or an empty list. */
  private isEmptyCustomFieldValue(value: unknown): boolean {
    return (
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)
    );
  }

  /** Runtime shape check for a single answer against its definition's type. */
  private isValidCustomFieldValue(
    type: CustomFieldType,
    value: unknown,
    options: string[],
  ): boolean {
    switch (type) {
      case 'text':
      case 'large_text':
      case 'date':
        return typeof value === 'string';
      case 'file':
        // One attachment id, or (Workiz-style) up to 5 of them.
        return (
          typeof value === 'string' ||
          (Array.isArray(value) &&
            value.length <= 5 &&
            value.every((v) => typeof v === 'string'))
        );
      case 'number':
        return typeof value === 'number' && Number.isFinite(value);
      case 'checkbox':
        return typeof value === 'boolean';
      case 'dropdown':
        return typeof value === 'string' && options.includes(value);
      case 'multi_select':
        return (
          Array.isArray(value) &&
          value.every((v) => typeof v === 'string' && options.includes(v as string))
        );
      default:
        return false;
    }
  }

  /**
   * Validate a bag of custom-field answers against the active catalog. Every
   * supplied key must name an active definition that applies to this deal's job
   * type (a definition applies iff its `jobTypeIds` is empty or includes the
   * deal's job type), and its value must match the definition's type. On create,
   * every applicable required field must carry a non-empty value.
   *
   * Returns the active-definition map so callers (update) can label timeline
   * diffs with the field's human name instead of its raw id.
   */
  private async validateCustomFields(
    customFields: Record<string, unknown>,
    jobTypeId: string,
    { forCreate }: { forCreate: boolean },
  ): Promise<Map<string, CustomFieldDefinition>> {
    const defs = new Map(
      (await this.customFields.list())
        .filter((d) => d.active)
        .map((d) => [d.id, d] as const),
    );

    const applies = (def: CustomFieldDefinition) =>
      def.jobTypeIds.length === 0 || def.jobTypeIds.includes(jobTypeId);

    for (const [id, value] of Object.entries(customFields)) {
      const def = defs.get(id);
      if (!def) {
        throw new BadRequestException(`Unknown or inactive custom field ${id}`);
      }
      if (!applies(def)) {
        throw new BadRequestException(
          `Custom field "${def.name}" does not apply to this deal's job type`,
        );
      }
      // A cleared answer is allowed through here; required-ness is enforced below.
      if (this.isEmptyCustomFieldValue(value)) continue;
      if (!this.isValidCustomFieldValue(def.type, value, def.options ?? [])) {
        throw new BadRequestException(
          `Custom field "${def.name}" has an invalid value for type "${def.type}"`,
        );
      }
    }

    if (forCreate) {
      const missing = [...defs.values()]
        .filter(
          (def) =>
            def.required &&
            applies(def) &&
            this.isEmptyCustomFieldValue(customFields[def.id]),
        )
        .map((def) => def.name);
      if (missing.length) {
        throw new BadRequestException(
          `Missing required custom field(s): ${missing.join(', ')}`,
        );
      }
    }

    return defs;
  }

  /**
   * The required-to-close gate. Before a deal reaches a terminal super-status,
   * every active custom-field definition that (a) applies to this deal's job
   * type and (b) is flagged `requiredToClose` must carry a non-empty answer on
   * the deal. Any that don't are reported together as a 422 whose payload lists
   * their ids AND names, so the web client can name exactly what to fill.
   */
  private async assertRequiredToCloseFilled(deal: Deal): Promise<void> {
    const applies = (def: CustomFieldDefinition) =>
      def.jobTypeIds.length === 0 || def.jobTypeIds.includes(deal.jobTypeId);

    const missing = (await this.customFields.list())
      .filter(
        (def) =>
          def.active &&
          def.requiredToClose &&
          applies(def) &&
          this.isEmptyCustomFieldValue(deal.customFields?.[def.id]),
      )
      .map((def) => ({ id: def.id, name: def.name }));

    if (missing.length) {
      throw new UnprocessableEntityException({
        message: `Fill required field(s) before closing: ${missing.map((f) => f.name).join(', ')}`,
        missingFields: missing,
      });
    }
  }

  async create(dto: CreateDealDto, caller: JwtUser): Promise<Deal> {
    const contactExists = await this.internalHttp.validateContact(dto.contactId);
    if (!contactExists) {
      throw new BadRequestException(`Contact ${dto.contactId} not found`);
    }

    // Admin-configured required fields (Settings → Job Fields) — same 422
    // shape as the close gate so clients can name the exact fields.
    const missingRequired =
      (await this.jobFieldSettings?.missingRequiredForCreate(dto)) ?? [];
    if (missingRequired.length) {
      throw new UnprocessableEntityException({
        message: `Fill required field(s): ${missingRequired.map((f) => f.label).join(', ')}`,
        missingFields: missingRequired.map((f) => ({ id: f.id, name: f.label })),
      });
    }

    const dealNumber = await this.repository.reserveDealNumber();
    const now = new Date().toISOString();
    const id = randomUUID();

    // Plain object for DynamoDB marshalling, geocoded if the caller sent no coords.
    const address = await this.resolveAddress(dto.address);

    // A hand-picked area wins outright — dispatch chose it, often because the
    // address is outside every area and the job still needs a market. Without
    // one, auto-resolve from the geocoded location; a match is authoritative
    // for the display label, and an explicit dto.serviceArea label is a
    // fallback used only when the address falls outside every area.
    const { serviceAreaId, serviceArea, area } = dto.serviceAreaId
      ? await this.pickServiceArea(dto.serviceAreaId)
      : await this.resolveServiceArea(address, dto.serviceArea);

    // 404s on an unknown id; a new deal may not use an archived type.
    const jobType = await this.jobTypes.findById(dto.jobTypeId);
    if (!jobType.active) {
      throw new BadRequestException(`Job type "${jobType.name}" is archived and cannot be used on a new deal`);
    }

    // Source is optional; validate only when supplied, and reject an archived one.
    if (dto.sourceId) {
      const source = await this.jobSources.findById(dto.sourceId);
      if (!source.active) {
        throw new BadRequestException(`Job source "${source.name}" is archived and cannot be used on a new deal`);
      }
    }

    // The referring partner is optional; same rule — a disabled one can't start a new job.
    if (dto.externalCompanyId) {
      const company = await this.externalCompanies.findById(dto.externalCompanyId);
      if (!company.active) {
        throw new BadRequestException(
          `External company "${company.name}" is disabled and cannot be used on a new deal`,
        );
      }
    }

    // Tags are optional and many; validate all against the catalog in one read,
    // rejecting unknown or archived ids on a new deal.
    const tagIds = dto.tagIds ?? [];
    if (tagIds.length) {
      const catalog = new Map((await this.jobTags.list()).map((t) => [t.id, t]));
      for (const tagId of tagIds) {
        const tag = catalog.get(tagId);
        if (!tag) throw new BadRequestException(`Job tag ${tagId} not found`);
        if (!tag.active) {
          throw new BadRequestException(`Job tag "${tag.name}" is archived and cannot be used on a new deal`);
        }
      }
    }

    // Custom-field answers: validated against the active catalog. Runs even when
    // none were supplied so a required applicable field can't be skipped.
    await this.validateCustomFields(dto.customFields ?? {}, dto.jobTypeId, { forCreate: true });

    // Company: requested → area default → billing default → none.
    const company = await this.companyForCreate(dto.businessProfileId, area);

    // Tax: exempt client → service-area tax → none.
    const tax = this.taxResolver
      ? DealTaxResolver.forCreate(
          await this.taxResolver.resolve({
            contactId: dto.contactId,
            companyId: dto.companyId,
            serviceAreaId,
          }),
        )
      : {};

    const deal: Deal = {
      id,
      dealNumber,
      contactId: dto.contactId,
      companyId: dto.companyId,
      clientType: dto.clientType,
      scheduledDate: dto.scheduledDate,
      scheduledEndDate: dto.scheduledEndDate,
      scheduledTimeSlot: dto.allDay ? undefined : dto.scheduledTimeSlot,
      allDay: dto.allDay,
      serviceArea,
      serviceAreaId,
      address,
      jobTypeId: dto.jobTypeId,
      superStatus: JobSuperStatus.SUBMITTED,
      assignedTechIds: [],
      assignedDispatcherId: caller.id,
      priority: dto.priority || DealPriority.NORMAL,
      sourceId: dto.sourceId,
      ...(company && { businessProfileId: company.id }),
      ...(company?.name && { businessProfileName: company.name }),
      externalCompanyId: dto.externalCompanyId,
      workOrderId: dto.workOrderId,
      poNumber: dto.poNumber,
      notes: dto.notes,
      tagIds,
      customFields: dto.customFields as Record<string, CustomFieldValue> | undefined,
      ...tax,
      itemCount: 0,
      status: DealStatus.ACTIVE,
      createdBy: caller.id,
      // The status clock starts with the job itself (drives "time in status").
      statusChangedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(deal);
    this.businessMetrics?.entityCreated.inc({ entity_type: 'deal' });

    await this.addTimelineEntry(deal.id, TimelineEventType.CREATED, caller, {});

    this.publishEvent('deal.created', {
      dealId: deal.id,
      dealNumber: deal.dealNumber,
      contactId: deal.contactId,
      jobTypeId: deal.jobTypeId,
      superStatus: deal.superStatus,
      createdBy: caller.id,
    });

    return deal;
  }

  async findById(id: string): Promise<Deal> {
    const cached = await this.cache.get(id);
    if (cached) {
      this.businessMetrics?.cacheHits.inc({ entity_type: 'deal' });
      return cached;
    }

    this.businessMetrics?.cacheMisses.inc({ entity_type: 'deal' });
    const deal = await this.repository.findById(id);
    if (!deal) {
      throw new NotFoundException(`Deal ${id} not found`);
    }

    await this.cache.set(deal);
    return deal;
  }

  async list(
    query: ListDealsQueryDto,
    caller: JwtUser,
    dataScope?: string,
  ) {
    // Query params arrive as strings (no global ValidationPipe/transform), so
    // coerce — a string Limit makes DynamoDB throw SerializationException.
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);

    // DataScope enforcement
    if (dataScope === 'assigned_only' && !query.techId) {
      query.techId = caller.id;
    }

    // Secondary filters applied on top of whichever index we query.
    const search = query.search?.trim();
    const filters: DealFilters = {
      jobTypeId: query.jobTypeId,
      sourceId: query.sourceId,
      businessProfileId: query.businessProfileId || undefined,
      serviceArea: query.serviceArea,
      clientType: query.clientType,
      priority: query.priority,
      tagIds: query.tagIds
        ? query.tagIds.split(',').map((t) => t.trim()).filter(Boolean)
        : undefined,
      dealNumber: this.parseDealNumberSearch(search),
      needsInvoice:
        query.needsInvoice === true || query.needsInvoice === 'true' ? true : undefined,
      // Carried on every index, not only the tech one: with `superStatus` the
      // status index answers, and an `assigned_only` caller must still see
      // just their own jobs in it.
      techId: query.techId,
    };

    // The most selective key picks the index; the technician, when present,
    // rides along as a filter (see `DealFilters.techId`). The tech index is
    // last so that a technician asking for one client's jobs gets that
    // client's, not their whole roster.
    if (query.superStatus) {
      return this.repository.findBySuperStatus(query.superStatus, limit, query.cursor, filters);
    }
    if (query.contactId) {
      return this.repository.findByContact(query.contactId, limit, query.cursor, filters);
    }
    if (query.dispatcherId) {
      return this.repository.findByDispatcher(query.dispatcherId, limit, query.cursor, filters);
    }
    if (query.techId) {
      return this.repository.findByTech(query.techId, limit, query.cursor, filters);
    }

    return this.repository.findAll(limit, query.cursor, {
      status: query.status,
      ...filters,
    });
  }

  /**
   * "#1042"/"1042" → legacy sequential id (number, matches the stored numeric
   * attribute); "#K4T9ZW"/"k4t9zw" → random 6-char code, uppercased. Anything
   * else (names, partial words) is not a Job ID search.
   */
  private parseDealNumberSearch(search?: string): string | number | undefined {
    if (!search) return undefined;
    const token = search.replace(/^#/, '');
    if (/^\d+$/.test(token)) return Number(token);
    if (isDealNumberCode(token)) return token.toUpperCase();
    return undefined;
  }

  async update(id: string, dto: UpdateDealDto, caller: JwtUser): Promise<Deal> {
    const existing = await this.findById(id);

    // Convert class instances to plain objects for DynamoDB
    const updates = { ...dto } as any;
    // A hand-picked area wins here exactly like on create — and it suppresses
    // the address-driven re-resolve below, or the geo answer would overwrite
    // the choice in the same write.
    if (updates.serviceAreaId) {
      const picked = await this.pickServiceArea(updates.serviceAreaId);
      updates.serviceAreaId = picked.serviceAreaId;
      updates.serviceArea = picked.serviceArea;
    }
    if (updates.address && !dto.serviceAreaId) {
      updates.address = await this.resolveAddress(
        updates.address,
        existing.address,
      );
      // Re-resolve the catalog service area whenever the address changes, so an
      // edited location moves the deal into the right territory (create-parity).
      const { serviceAreaId, serviceArea } = await this.resolveServiceArea(
        updates.address,
        updates.serviceArea ?? existing.serviceArea,
      );
      updates.serviceArea = serviceArea;
      // The update builder SKIPS `undefined` and only REMOVEs on an explicit
      // `null`, so an address edited to outside every area would otherwise keep
      // the previous territory's id forever. Harmless while nothing read the
      // field — but per-market caller id does, and that job would dial its
      // client from the wrong market's number.
      //
      // Only send the null when there is genuinely something to clear: writing
      // it unconditionally turns "this deal never had an area" into a field
      // change, and every address edit would log a phantom timeline entry.
      if (serviceAreaId) {
        updates.serviceAreaId = serviceAreaId;
      } else if (existing.serviceAreaId) {
        (updates as Record<string, unknown>).serviceAreaId = null;
      }
    }

    // Archived types are allowed on update so an old deal stays editable; only
    // the id's existence is enforced.
    if (updates.jobTypeId) await this.jobTypes.findById(updates.jobTypeId);
    // Archived source allowed on update so an old deal stays editable.
    if (updates.sourceId) await this.jobSources.findById(updates.sourceId);
    // Disabled company allowed on update so an old job stays editable.
    if (updates.externalCompanyId) await this.externalCompanies.findById(updates.externalCompanyId);
    // Company: undefined → untouched; same id → no-op; null/'' → cleared; a new
    // id must be an active company. The name is snapshotted alongside.
    let companyChange: { from: CompanyRef | null; to: CompanyRef | null } | undefined;
    if (dto.businessProfileId !== undefined) {
      const next = dto.businessProfileId?.trim() || null;
      if ((next ?? undefined) === existing.businessProfileId) {
        delete updates.businessProfileId;
      } else {
        const to: CompanyRef | null = next
          ? this.businessProfiles
            ? await this.businessProfiles.resolve(next)
            : { id: next }
          : null;
        updates.businessProfileId = to?.id ?? null;
        updates.businessProfileName = to?.name ?? null;
        companyChange = {
          from: existing.businessProfileId
            ? { id: existing.businessProfileId, name: existing.businessProfileName }
            : null,
          to,
        };
      }
    }
    // Tags: archived allowed on update; enforce each id exists.
    if (updates.tagIds?.length) {
      const known = new Set((await this.jobTags.list()).map((t) => t.id));
      for (const tagId of updates.tagIds) {
        if (!known.has(tagId)) throw new BadRequestException(`Job tag ${tagId} not found`);
      }
    }

    // Custom fields patch: validate only the supplied keys (against the target
    // job type), then merge onto the stored bag so untouched answers survive —
    // DynamoDB writes `customFields` as one whole map, so a partial write would
    // otherwise drop every key not present in this request.
    const customFieldsPatch = dto.customFields;
    let customFieldDefs: Map<string, CustomFieldDefinition> | undefined;
    if (customFieldsPatch) {
      customFieldDefs = await this.validateCustomFields(
        customFieldsPatch,
        updates.jobTypeId ?? existing.jobTypeId,
        { forCreate: false },
      );
      updates.customFields = { ...(existing.customFields ?? {}), ...customFieldsPatch };
    }

    // A job that moved market picks up that market's tax (unless someone chose
    // the tax by hand). Written in the same update; logged as TAX_CHANGED below.
    let taxChange: { from: DealTaxSnapshot; to: DealTaxSnapshot } | undefined;
    if (
      updates.serviceAreaId !== undefined &&
      (updates.serviceAreaId ?? undefined) !== existing.serviceAreaId
    ) {
      taxChange = await this.reresolveTax(existing, {
        serviceAreaId: updates.serviceAreaId ?? undefined,
      });
      if (taxChange) Object.assign(updates, taxChange.to);
    }

    const result = await this.repository.update(id, updates);
    await this.cache.invalidate(id);
    // Any edit must reach the search index (address, custom fields, notes…).
    this.publishEvent('deal.updated', {
      dealId: id,
      updatedBy: caller.id,
      ...(companyChange && { businessProfileId: companyChange.to?.id ?? null }),
    });

    // Moving the deal's date re-stamps its assignment rows (so each tech's day
    // re-sorts on the tech index) and renumbers both the old and new days.
    if (updates.scheduledDate !== undefined && updates.scheduledDate !== existing.scheduledDate) {
      await this.repository.restampAssignmentDates(id, updates.scheduledDate, caller.id);
      for (const techId of existing.assignedTechIds) {
        await this.renumberTechSchedule(techId, existing.scheduledDate);
        await this.renumberTechSchedule(techId, updates.scheduledDate);
      }
    }

    // Track field changes in timeline: one entry per field that actually
    // changed, carrying both the previous and the new value. Diffed against the
    // final write payload so auto-derived fields (service area) are covered too.
    for (const [key, value] of Object.entries(updates as Record<string, unknown>)) {
      if (value === undefined) continue;
      // Custom fields are diffed per-answer below, labeled by their human name.
      if (key === 'customFields') continue;
      // Tax snapshot changes get one TAX_CHANGED entry instead.
      if (TAX_KEYS.has(key)) continue;
      // The company gets one labeled entry below.
      if (COMPANY_KEYS.has(key)) continue;
      const previous = (existing as unknown as Record<string, unknown>)[key];
      if (this.valuesEqual(previous, value)) continue;
      await this.addTimelineEntry(id, TimelineEventType.FIELD_UPDATED, caller, {
        field: key,
        oldValue: previous ?? null,
        newValue: value,
      });
    }

    if (companyChange) {
      await this.addTimelineEntry(id, TimelineEventType.FIELD_UPDATED, caller, {
        field: 'businessProfileId',
        oldValue: companyChange.from?.id ?? null,
        newValue: companyChange.to?.id ?? null,
        oldLabel: companyChange.from?.name ?? null,
        newLabel: companyChange.to?.name ?? null,
      });
    }

    if (taxChange) {
      await this.addTimelineEntry(id, TimelineEventType.TAX_CHANGED, caller, {
        ...taxChange,
        reason: 'service_area_changed',
      });
    }

    // One timeline entry per changed custom-field answer, labeled with the
    // definition's name (not the raw id) so the history reads for humans.
    if (customFieldsPatch && customFieldDefs) {
      for (const [fieldId, newValue] of Object.entries(customFieldsPatch)) {
        const previous = existing.customFields?.[fieldId];
        if (this.valuesEqual(previous, newValue)) continue;
        const def = customFieldDefs.get(fieldId);
        await this.addTimelineEntry(id, TimelineEventType.FIELD_UPDATED, caller, {
          field: def?.name ?? fieldId,
          oldValue: previous ?? null,
          newValue,
        });
      }
    }

    return result;
  }

  /**
   * Point a job at a different client.
   *
   * Used when the details captured during a call turn out to belong to someone
   * else — the CRM makes a separate client, and the job follows them. The old
   * client keeps their own history; only this job moves.
   */
  async changeContact(id: string, contactId: string, caller: JwtUser): Promise<Deal> {
    const existing = await this.findById(id);
    if (existing.contactId === contactId) return existing;

    const contactExists = await this.internalHttp.validateContact(contactId);
    if (!contactExists) {
      throw new BadRequestException(`Contact ${contactId} not found`);
    }

    await this.repository.reassignContact(id, contactId);
    // The new client may be tax-exempt (or the old one was).
    const taxChange = await this.reresolveTax(existing, { contactId });
    if (taxChange) await this.repository.update(id, { ...taxChange.to });
    await this.cache.invalidate(id);
    await this.addTimelineEntry(id, TimelineEventType.FIELD_UPDATED, caller, {
      field: 'contactId',
      oldValue: existing.contactId,
      newValue: contactId,
    });
    if (taxChange) {
      await this.addTimelineEntry(id, TimelineEventType.TAX_CHANGED, caller, {
        ...taxChange,
        reason: 'client_changed',
      });
    }
    this.publishEvent('deal.updated', { dealId: id, updatedBy: caller.id });

    return this.findById(id);
  }

  /**
   * Re-run tax resolution for a deal about to change market or client. Returns
   * the before/after snapshots only when the tax actually changes, and never
   * touches a tax a user picked by hand (`taxSource: 'manual'`).
   */
  private async reresolveTax(
    existing: Deal,
    changes: { serviceAreaId?: string; contactId?: string },
  ): Promise<{ from: DealTaxSnapshot; to: DealTaxSnapshot } | undefined> {
    if (!this.taxResolver || existing.taxSource === 'manual') return undefined;
    const to = await this.taxResolver.resolve({
      contactId: changes.contactId ?? existing.contactId,
      companyId: existing.companyId,
      serviceAreaId:
        'serviceAreaId' in changes ? changes.serviceAreaId : existing.serviceAreaId,
    });
    const from = DealTaxResolver.fromDeal(existing);
    return DealTaxResolver.sameTax(from, to) ? undefined : { from, to };
  }

  /** Keep `Deal.itemCount` (drives "needs invoice") in step with the line rows. */
  private async syncItemCount(id: string): Promise<void> {
    const itemCount = await this.productsRepo.countByDeal(id);
    await this.repository.update(id, { itemCount });
  }

  async softDelete(id: string, caller: JwtUser): Promise<void> {
    await this.findById(id);
    await this.repository.softDelete(id);
    await this.cache.invalidate(id);
    this.publishEvent('deal.deleted', { dealId: id, deletedBy: caller.id });
  }

  /**
   * Move a deal's status: set its fixed super-status plus an optional custom
   * sub-status filed under it. Gated at the controller by `deals.move_status`
   * (a single matrix permission — the old per-transition `dealStageTransitions`
   * rules are gone). Omitting `subStatusId` clears any existing sub-status.
   */
  async moveStatus(id: string, dto: MoveStatusDto, caller: JwtUser): Promise<Deal> {
    const deal = await this.findById(id);

    // A sub-status, if supplied, must belong to the target super-status.
    let sub;
    if (dto.subStatusId) {
      sub = await this.jobStatuses.findById(dto.subStatusId);
      if (sub.group !== dto.superStatus) {
        throw new BadRequestException(
          `Sub-status "${sub.name}" does not belong to super-status ${dto.superStatus}`,
        );
      }
    }

    // Canceling needs a reason. A Canceled sub-status IS the reason (the
    // catalog mirrors the old CRM's cancellation list), so its name fills in
    // when none was typed; without either the move is rejected.
    let cancellationReason = dto.cancellationReason;
    if (dto.superStatus === JobSuperStatus.CANCELED && !cancellationReason) {
      if (sub) cancellationReason = sub.name;
      else {
        throw new BadRequestException(
          'Pick a cancellation sub-status or provide a cancellation reason',
        );
      }
    }

    // Closing the deal (any terminal super-status) enforces the required-to-close
    // gate: every applicable requiredToClose custom field must carry an answer.
    if (TERMINAL_SUPER_STATUSES.has(dto.superStatus)) {
      await this.assertRequiredToCloseFilled(deal);
    }

    const from = deal.superStatus;
    const updates: DealUpdate = {
      superStatus: dto.superStatus,
      // Always reconcile the sub-status: the provided one, or cleared. `null`
      // (not undefined) so the repository REMOVEs it — a sub-status belongs to a
      // single super-status, so moving without one must drop the old, and
      // `update()` skips undefined (which left the stale sub-status attached).
      subStatusId: dto.subStatusId || null,
    };
    if (cancellationReason) {
      updates.cancellationReason = cancellationReason;
    }

    // Re-stamp the status clock only on a real move — repeating the current
    // status (and sub-status) must not reset "time in status".
    const subChanged = (dto.subStatusId || null) !== (deal.subStatusId ?? null);
    if (dto.superStatus !== from || subChanged) {
      updates.statusChangedAt = new Date().toISOString();
    }

    // Closing (Done/Canceled, or their sub-statuses) stamps closedAt; leaving a
    // closed status clears it. done_pending_approval isn't a close.
    if (CLOSED_SUPER_STATUSES.has(dto.superStatus)) {
      updates.closedAt = new Date().toISOString();
    } else if (CLOSED_SUPER_STATUSES.has(from)) {
      updates.closedAt = null;
    }

    const result = await this.repository.update(id, updates);
    await this.cache.invalidate(id);
    this.businessMetrics?.dealStageTransitions.inc({ from_stage: from, to_stage: dto.superStatus });

    await this.addTimelineEntry(id, TimelineEventType.STATUS_CHANGED, caller, {
      fromStatus: from,
      toStatus: dto.superStatus,
      fromSubStatusId: deal.subStatusId ?? null,
      subStatusId: dto.subStatusId || null,
    });

    this.publishEvent('deal.status_changed', {
      dealId: id,
      oldStatus: from,
      newStatus: dto.superStatus,
      changedBy: caller.id,
    });

    if (dto.superStatus === JobSuperStatus.DONE) {
      this.publishEvent('deal.completed', {
        dealId: id,
        completedAt: new Date().toISOString(),
      });
    }

    return result;
  }

  async getTimeline(dealId: string, limit = 20, cursor?: string) {
    await this.findById(dealId); // verify deal exists
    return this.timelineRepo.findByDeal(dealId, limit, cursor);
  }

  /**
   * Record on the job that a call was attached to it (or detached). Written by
   * telephony-service, so the job's activity feed carries calls alongside
   * everything else that happened — recording included, via `details`.
   */
  async recordCallLink(
    dealId: string,
    linked: boolean,
    details: Record<string, unknown>,
    actor: { id: string; name: string },
  ): Promise<void> {
    await this.findById(dealId);
    // Written directly: addTimelineEntry stamps `caller.email` as the label,
    // and this actor arrives with a display name instead of a JWT.
    await this.timelineRepo.addEntry({
      id: randomUUID(),
      dealId,
      eventType: linked
        ? TimelineEventType.CALL_LINKED
        : TimelineEventType.CALL_UNLINKED,
      actorId: actor.id,
      actorName: actor.name,
      timestamp: new Date().toISOString(),
      details,
    });
  }

  async addNote(id: string, dto: AddNoteDto, caller: JwtUser): Promise<void> {
    await this.findById(id);
    await this.addTimelineEntry(id, TimelineEventType.NOTE_ADDED, caller, {}, dto.note);
  }

  /** Only user-authored notes are editable — system events stay immutable. */
  private async findNoteEntry(dealId: string, timestamp: string, entryId: string) {
    const entry = await this.timelineRepo.getEntry(dealId, timestamp, entryId);
    if (!entry) throw new NotFoundException('Timeline entry not found');
    if (entry.eventType !== TimelineEventType.NOTE_ADDED) {
      throw new BadRequestException('Only notes can be edited or deleted');
    }
    return entry;
  }

  async updateNote(
    id: string,
    entryId: string,
    dto: UpdateNoteDto,
    caller: JwtUser,
  ): Promise<void> {
    await this.findNoteEntry(id, dto.timestamp, entryId);
    await this.timelineRepo.updateNote(id, dto.timestamp, entryId, dto.note);
    this.logger.log(`Note ${entryId} on deal ${id} edited by ${caller.id}`);
  }

  async deleteNote(
    id: string,
    entryId: string,
    timestamp: string,
    caller: JwtUser,
  ): Promise<void> {
    await this.findNoteEntry(id, timestamp, entryId);
    await this.timelineRepo.deleteEntry(id, timestamp, entryId);
    this.logger.log(`Note ${entryId} on deal ${id} deleted by ${caller.id}`);
  }

  /**
   * Candidates for assigning this deal, read from the local eligibility
   * projection rather than user-service — the ids there are catalog ids, so the
   * match is exact. (The previous implementation compared a deal's `lock_change`
   * slug against a technician's hand-typed "Lock Change", and so returned
   * nothing.)
   *
   * Every technician is returned, not just the matching ones: dispatchers keep
   * the right to override, and `eligible` + `reasons` let the UI say why someone
   * doesn't qualify instead of silently hiding them.
   */
  async getQualifiedTechs(id: string) {
    const deal = await this.findById(id);
    return this.rankQualifiedTechsFor({
      jobTypeId: deal.jobTypeId,
      serviceAreaId: deal.serviceAreaId,
      lat: deal.address.lat,
      lng: deal.address.lng,
    });
  }

  /**
   * Rank technicians for a job described by params rather than a saved deal —
   * so the New Job form can suggest who can do the work (right job type, in the
   * service area) before the deal exists. Same scoring and shape as
   * getQualifiedTechs; distance is measured from the given point when present.
   */
  async rankQualifiedTechsFor(params: {
    jobTypeId: string;
    serviceAreaId?: string;
    lat?: number;
    lng?: number;
  }) {
    const candidates = await this.eligibility.listAll();

    return candidates
      .map((tech) => {
        const reasons: string[] = [];
        // First, and disqualifying on its own: user-service does not call this
        // person an assignable technician. Such a row should not be here at all
        // — the event handler removes it and the boot reconcile sweeps up what
        // no event covers — but for as long as one is, it reaches the UI
        // carrying its reason, never as a bare name the dispatcher is left to
        // read as a technician.
        if (!tech.assignable) reasons.push('not_assignable');
        // An empty job type means "any" — skip the job-type check entirely.
        if (params.jobTypeId && !tech.jobTypeIds.includes(params.jobTypeId)) {
          reasons.push('missing_job_type');
        }
        if (!params.serviceAreaId || !tech.serviceAreaIds.includes(params.serviceAreaId)) {
          reasons.push('outside_area');
        }

        const distance =
          params.lat !== undefined &&
          params.lng !== undefined &&
          tech.homeAddress?.lat !== undefined &&
          tech.homeAddress?.lng !== undefined
            ? distanceMiles(params.lat, params.lng, tech.homeAddress.lat, tech.homeAddress.lng)
            : null;

        return {
          id: tech.technicianId,
          firstName: tech.firstName,
          lastName: tech.lastName,
          department: tech.department,
          jobTypeIds: tech.jobTypeIds,
          serviceAreaIds: tech.serviceAreaIds,
          eligible: reasons.length === 0,
          reasons,
          distanceMiles: distance,
        };
      })
      .sort(
        (a, b) =>
          Number(b.eligible) - Number(a.eligible) ||
          // Below every real technician who merely doesn't fit this job: a
          // close home address must not float a non-technician to the top of
          // the list a dispatcher scans.
          Number(a.reasons.includes('not_assignable')) -
            Number(b.reasons.includes('not_assignable')) ||
          (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity),
      );
  }

  /**
   * Set the full technician roster on a deal (equal peers). Diffs the requested
   * set against the current one: adds/removes assignment rows, renumbers each
   * affected tech's day, and emits a per-tech event + timeline entry. The deal
   * auto-transitions to ASSIGNED only when it goes from unassigned → assigned.
   */
  async assignTechs(id: string, techIds: string[], caller: JwtUser): Promise<Deal> {
    const deal = await this.findById(id);

    const current = new Set(deal.assignedTechIds);
    const requested = new Set(techIds);
    const toAdd = techIds.filter((t) => !current.has(t));
    const toRemove = deal.assignedTechIds.filter((t) => !requested.has(t));
    if (!toAdd.length && !toRemove.length) return deal;

    for (const t of toAdd) await this.repository.addAssignment(id, t, deal.scheduledDate, caller.id);
    for (const t of toRemove) await this.repository.removeAssignment(id, t);

    const nextRoster = [...requested];
    const updates: Partial<Deal> = { assignedTechIds: nextRoster };

    // First assignment advances a still-Submitted deal into In Progress.
    if (
      deal.assignedTechIds.length === 0 &&
      nextRoster.length > 0 &&
      deal.superStatus === JobSuperStatus.SUBMITTED
    ) {
      updates.superStatus = JobSuperStatus.IN_PROGRESS;
    }

    // Drop removed techs' per-tech sequence entries.
    if (toRemove.length) {
      const sequences = { ...(deal.sequences ?? {}) };
      for (const t of toRemove) delete sequences[t];
      updates.sequences = sequences;
    }

    await this.repository.update(id, updates);
    await this.cache.invalidate(id);
    if (toAdd.length) this.businessMetrics?.dealTechAssignments.inc();

    // Slot the deal into each affected tech's day by scheduled time.
    for (const t of new Set([...toAdd, ...toRemove])) {
      await this.renumberTechSchedule(t, deal.scheduledDate);
    }

    for (const t of toAdd) {
      await this.addTimelineEntry(id, TimelineEventType.TECH_ASSIGNED, caller, { techId: t });
      this.publishEvent('deal.tech_assigned', { dealId: id, techId: t, assignedBy: caller.id });
    }
    for (const t of toRemove) {
      await this.addTimelineEntry(id, TimelineEventType.TECH_UNASSIGNED, caller, { previousTechId: t });
      this.publishEvent('deal.tech_unassigned', { dealId: id, techId: t, unassignedBy: caller.id });
    }

    await this.cache.invalidate(id);
    return this.findById(id);
  }

  /** Remove a single technician from a deal's roster. */
  async unassignTech(id: string, techId: string, caller: JwtUser): Promise<Deal> {
    const deal = await this.findById(id);

    if (!deal.assignedTechIds.includes(techId)) {
      throw new BadRequestException('Technician is not assigned to this deal');
    }

    await this.repository.removeAssignment(id, techId);
    const sequences = { ...(deal.sequences ?? {}) };
    delete sequences[techId];
    await this.repository.update(id, {
      assignedTechIds: deal.assignedTechIds.filter((t) => t !== techId),
      sequences,
    });
    await this.cache.invalidate(id);

    // Close the gap the removed job left in the technician's sequence.
    await this.renumberTechSchedule(techId, deal.scheduledDate);

    await this.addTimelineEntry(id, TimelineEventType.TECH_UNASSIGNED, caller, {
      previousTechId: techId,
    });
    this.publishEvent('deal.tech_unassigned', { dealId: id, techId, unassignedBy: caller.id });

    await this.cache.invalidate(id);
    return this.findById(id);
  }

  // ------------------------------------------------- send to tech / seen

  /**
   * Workiz "Send to tech": hand the job to its technicians over the picked
   * channels. The deal is stamped at the click (`sentToTechAt` = Workiz
   * `last_sent`, `sentToTechVia`, `sentToTechBy`; `sentAt` / `sentVia` on
   * each `ASSIGN#` row), a `sent_to_tech` timeline entry is written and one
   * `deal.sent_to_tech` event goes out — messaging-service renders the
   * settings `smsFormat` text and delivers it per channel, then reports
   * back through `recordSentToTechDelivery`. Re-pressing is a resend: a new
   * `sentAt`, so the consumer's idempotency key changes.
   */
  async sendToTech(id: string, dto: SendToTechDto, caller: JwtUser): Promise<Deal> {
    const deal = await this.findById(id);
    if (deal.status !== DealStatus.ACTIVE) {
      throw new BadRequestException('A deleted job cannot be sent to a technician');
    }
    if (!deal.assignedTechIds.length) {
      throw new BadRequestException('Assign a technician before sending the job');
    }

    const roster = new Set(deal.assignedTechIds);
    const techIds = dto.techIds?.length ? [...new Set(dto.techIds)] : [...deal.assignedTechIds];
    const strangers = techIds.filter((t) => !roster.has(t));
    if (strangers.length) {
      throw new BadRequestException(
        `Technician${strangers.length > 1 ? 's' : ''} ${strangers.join(', ')} ${strangers.length > 1 ? 'are' : 'is'} not assigned to this job`,
      );
    }

    const channels = [...new Set(dto.channels)];
    const sentAt = new Date().toISOString();

    // Order matters: the per-technician rows first, the job's own stamp only
    // once they are written, the timeline entry and the event last of all. A
    // write that fails here has to leave the job "not sent" — the alternative
    // is a job reading `Sent · 12:10 PM` forever for a send no consumer was
    // ever told to deliver, where pressing Resend repeats the same failure.
    await this.repository.markAssignmentsSent(id, techIds, { sentAt, sentVia: channels, sentBy: caller.id });
    await this.repository.update(id, {
      sentToTechAt: sentAt,
      sentToTechVia: channels,
      sentToTechBy: caller.id,
    });
    await this.cache.invalidate(id);

    await this.addTimelineEntry(id, TimelineEventType.SENT_TO_TECH, caller, { techIds, channels, sentAt });

    const payload: DealSentToTechEvent = {
      dealId: id,
      dealNumber: deal.dealNumber,
      techIds,
      channels,
      sentAt,
      sentBy: caller.id,
    };
    this.publishEvent(DealEventType.SENT_TO_TECH, { ...payload });

    return this.findById(id);
  }

  /**
   * Workiz `seen` / "Viewed job in app": the technician's app calls this
   * when it opens the job. Only an assigned technician counts — anyone else
   * (a dispatcher previewing) is answered `seen: false` and nothing is
   * written, so the client can call it blindly. First open stamps the
   * `ASSIGN#` row, the deal's `seenByTechAt` (once, for the whole job) and
   * a `seen_by_tech` timeline entry; later opens are no-ops.
   */
  async markSeenByTech(
    id: string,
    caller: JwtUser,
  ): Promise<{ seen: boolean; seenAt?: string; first: boolean }> {
    const deal = await this.findById(id);
    if (!deal.assignedTechIds.includes(caller.id)) return { seen: false, first: false };

    const now = new Date().toISOString();
    const stored = await this.repository.markAssignmentSeen(id, caller.id, now);
    const first = stored === now;
    if (!first) return { seen: true, seenAt: stored, first: false };

    if (!deal.seenByTechAt) {
      await this.repository.update(id, { seenByTechAt: now });
    }
    await this.cache.invalidate(id);
    await this.addTimelineEntry(id, TimelineEventType.SEEN_BY_TECH, caller, { techId: caller.id, seenAt: now });
    return { seen: true, seenAt: now, first: true };
  }

  /**
   * Messaging-service's report for one (technician, channel) of a send —
   * stored on the `ASSIGN#` row so the job page can say "SMS delivered,
   * email skipped: no address". A report for an older click than the row's
   * current `sentAt` is ignored (a slow consumer must not describe the
   * previous send as the latest). Skips and failures are logged; the
   * dispatcher's click already stamped the job, Workiz-style.
   */
  async recordSentToTechDelivery(id: string, dto: RecordSentToTechDto): Promise<{ recorded: boolean }> {
    const assignment = await this.repository.getAssignment(id, dto.techId);
    if (!assignment) {
      this.logger.warn(`sent-to-tech delivery for ${id}/${dto.techId} ignored: technician not on the job`);
      return { recorded: false };
    }
    if (assignment.sentAt && assignment.sentAt > dto.sentAt) {
      this.logger.log(`sent-to-tech delivery for ${id}/${dto.techId} (${dto.channel}) ignored: a newer send exists`);
      return { recorded: false };
    }

    await this.repository.recordAssignmentDelivery(id, dto.techId, dto.channel, {
      status: dto.status,
      sentAt: dto.sentAt,
      at: dto.at ?? new Date().toISOString(),
      ...(dto.reason && { reason: dto.reason }),
      ...(dto.messageId && { messageId: dto.messageId }),
      ...(dto.conversationId && { conversationId: dto.conversationId }),
    });
    if (dto.status !== 'sent') {
      this.logger.warn(`sent-to-tech ${dto.channel} for ${id}/${dto.techId} ${dto.status}: ${dto.reason ?? 'no reason given'}`);
    }
    return { recorded: true };
  }

  /** The per-technician sent / seen stamps of a deal (`ASSIGN#` rows). */
  async getAssignments(id: string) {
    await this.findById(id);
    return this.repository.listAssignments(id);
  }

  /* ----------------------------------------------------- technician flow */

  /**
   * Who may act *as the technician on the job*.
   *
   * The roster is the rule: "I've got it", "I'm here" are first-person
   * statements, and a dispatcher making them on somebody's behalf is the
   * normal office case (a technician with no signal, a phone call) — so
   * dispatch is allowed too, and the timeline records who actually tapped.
   * A technician whose deals scope is `assigned_only` and who is NOT on the
   * roster is refused: that is somebody else's job.
   */
  private assertTechActionAllowed(
    deal: Deal,
    caller: JwtUser,
    dealScope?: string,
  ): void {
    if (deal.assignedTechIds.includes(caller.id)) return;
    if (dealScope === DataScope.ASSIGNED_ONLY) {
      throw new ForbiddenException('Only a technician assigned to this job can do that');
    }
  }

  /** A job nobody can work any more takes no technician actions. */
  private assertJobOpen(deal: Deal): void {
    if (TERMINAL_SUPER_STATUSES.has(deal.superStatus)) {
      throw new BadRequestException('This job is closed');
    }
  }

  /**
   * "Confirm receipt" — Workiz's *Confirmed job receipt* (≈15k in the export).
   * The technician acknowledges the assignment from their phone; dispatch then
   * knows the job has been seen rather than hoping.
   *
   * The stamp is per-technician and lives on that technician's own `ASSIGN#`
   * row. The deal metadata mirrors the FIRST confirmation so a list view — the
   * dispatch board, "My jobs" — can show it without reading a row per job.
   *
   * Idempotent: a second tap keeps the first timestamp and writes no second
   * timeline entry. "A second tap" is per technician — each technician on a
   * two-tech job confirms their own row and so gets their own entry — while a
   * caller who is NOT on the roster (dispatch acting for somebody) has no row
   * of their own and rides the deal-level mirror instead: once the job carries
   * a confirmation, their repeat taps do nothing at all.
   */
  async confirmReceipt(id: string, caller: JwtUser, dealScope?: string): Promise<Deal> {
    const deal = await this.findById(id);
    this.assertTechActionAllowed(deal, caller, dealScope);
    this.assertJobOpen(deal);

    const existing = await this.repository.getAssignment(id, caller.id);
    if (existing?.techConfirmedAt) return deal;

    const onRoster = deal.assignedTechIds.includes(caller.id);
    // Off the roster there is no `ASSIGN#` row to remember the tap, so the
    // deal-level mirror is the only stamp there is: without this, every retry
    // of a dispatcher's Confirm wrote another feed entry and another event.
    if (!onRoster && deal.techConfirmedAt) return deal;

    const at = new Date().toISOString();
    // Only an assigned technician has a row to stamp; dispatch confirming on
    // somebody's behalf records the deal-level mirror and the timeline entry.
    // That write is conditional (`if_not_exists`) and answers with whatever was
    // already there, so two taps that both race past the read above still leave
    // one entry: the loser stops here.
    if (onRoster) {
      const alreadyConfirmedAt = await this.repository.confirmAssignment(id, caller.id, at);
      if (alreadyConfirmedAt) return deal;
    }

    const result = deal.techConfirmedAt
      ? deal
      : await this.repository.update(id, { techConfirmedAt: at, techConfirmedBy: caller.id });
    await this.cache.invalidate(id);

    await this.addTimelineEntry(id, TimelineEventType.TECH_CONFIRMED, caller, {
      techId: caller.id,
      confirmedAt: at,
    });
    this.publishEvent('deal.tech_confirmed', { dealId: id, techId: caller.id, confirmedAt: at });

    return result;
  }

  /**
   * The catalog's own "arrived" sub-status, when it has one. The old CRM has no
   * fixed arrival sub-status — every workspace names it itself — so this looks
   * for one under In Progress rather than inventing a row. Nothing found means
   * the job keeps whatever sub-status it had.
   */
  private static readonly ARRIVED_SUBSTATUS = /^(arrived|on[\s-]?site)\b/i;

  private async arrivalSubStatusId(deal: Deal): Promise<string | undefined> {
    // A sub-status belongs to exactly one super-status, so it can only be
    // applied while the job actually sits in In Progress.
    if (deal.superStatus !== JobSuperStatus.IN_PROGRESS) return undefined;
    const all = await this.jobStatuses.list();
    const match = all.find(
      (s) =>
        s.active &&
        s.group === JobSuperStatus.IN_PROGRESS &&
        DealsService.ARRIVED_SUBSTATUS.test(s.name.trim()),
    );
    return match?.id;
  }

  /**
   * "Arrived" — Workiz's *Arrived at location* (30 427 in the export). Stamps
   * when the technician reached the door, who, and the GPS fix their phone
   * offered (absent when the permission was declined), and moves the job onto
   * the catalog's arrival sub-status if the workspace has one.
   *
   * Idempotent like confirm: the first arrival is the arrival.
   */
  async markArrived(
    id: string,
    dto: { lat?: number; lng?: number; accuracy?: number; subStatusId?: string },
    caller: JwtUser,
    dealScope?: string,
  ): Promise<Deal> {
    const deal = await this.findById(id);
    this.assertTechActionAllowed(deal, caller, dealScope);
    this.assertJobOpen(deal);
    if (deal.arrivedAt) return deal;

    // An explicitly chosen sub-status is validated exactly as moveStatus does.
    let subStatusId = dto.subStatusId;
    if (subStatusId) {
      const sub = await this.jobStatuses.findById(subStatusId);
      if (sub.group !== deal.superStatus) {
        throw new BadRequestException(
          `Sub-status "${sub.name}" does not belong to super-status ${deal.superStatus}`,
        );
      }
    } else {
      subStatusId = await this.arrivalSubStatusId(deal);
    }

    const at = new Date().toISOString();
    const updates: DealUpdate = { arrivedAt: at, arrivedBy: caller.id };
    if (dto.lat !== undefined && dto.lng !== undefined) {
      updates.arrivedLocation = {
        lat: dto.lat,
        lng: dto.lng,
        ...(dto.accuracy !== undefined ? { accuracy: dto.accuracy } : {}),
      };
    }
    if (subStatusId && subStatusId !== deal.subStatusId) {
      updates.subStatusId = subStatusId;
      updates.statusChangedAt = at;
    }

    const result = await this.repository.update(id, updates);
    await this.cache.invalidate(id);

    await this.addTimelineEntry(id, TimelineEventType.TECH_ARRIVED, caller, {
      techId: caller.id,
      arrivedAt: at,
      ...(updates.arrivedLocation ? { location: updates.arrivedLocation } : {}),
      ...(updates.subStatusId ? { subStatusId: updates.subStatusId } : {}),
    });
    this.publishEvent('deal.tech_arrived', { dealId: id, techId: caller.id, arrivedAt: at });

    return result;
  }

  /** Every active deal a technician has, drained across pages. */
  private async listTechDeals(techId: string): Promise<Deal[]> {
    const all: Deal[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.repository.findByTech(techId, 100, cursor);
      all.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor && all.length < 500);
    return all.filter((d) => !TERMINAL_SUPER_STATUSES.has(d.superStatus));
  }

  /**
   * Renumber a technician's schedule for a day: earliest scheduled job is [1].
   * Jobs are visited in scheduled-time order (EPIC-4's time-based sequencing),
   * so assigning or removing one keeps that tech's badges contiguous. Only this
   * technician's entry in each deal's `sequences` map is touched.
   */
  private async renumberTechSchedule(
    techId: string,
    date?: string,
  ): Promise<void> {
    if (!techId) return;

    const deals = (await this.listTechDeals(techId))
      .filter((d) => !date || d.scheduledDate === date)
      .sort((a, b) =>
        (a.scheduledTimeSlot ?? '~').localeCompare(b.scheduledTimeSlot ?? '~'),
      );

    await this.writeSequence(techId, deals.map((d) => d.id));
  }

  /** Persist `sequences[techId] = 1..N` across the given deals, in order. */
  private async writeSequence(techId: string, orderedIds: string[]): Promise<void> {
    await Promise.all(
      orderedIds.map(async (id, index) => {
        const deal = await this.repository.findById(id);
        if (!deal) return;
        const sequences = { ...(deal.sequences ?? {}), [techId]: index + 1 };
        await this.repository.update(id, { sequences } as Partial<Deal>);
      }),
    );
    for (const id of orderedIds) await this.cache.invalidate(id);
  }

  /**
   * Manual drag-to-reorder of a technician's day. Writes that tech's sequence in
   * the given order, ignoring any id that isn't actually this technician's.
   */
  async reorderSchedule(
    dto: { techId: string; orderedDealIds: string[] },
    caller: JwtUser,
  ): Promise<void> {
    const owned = new Set(
      (await this.listTechDeals(dto.techId)).map((d) => d.id),
    );
    const ordered = dto.orderedDealIds.filter((id) => owned.has(id));

    await this.writeSequence(dto.techId, ordered);

    for (const id of ordered) {
      await this.addTimelineEntry(id, TimelineEventType.FIELD_UPDATED, caller, {
        field: `sequences.${dto.techId}`,
        newValue: ordered.indexOf(id) + 1,
      });
    }
  }

  /**
   * The referenced product must exist in inventory and its type must match the
   * requested fulfillment: a `service`-type product can only be a service line,
   * and a stockable product can only be `sourced` / `to_order`.
   */
  private async validateProductFulfillment(
    dto: { productId: string; name: string },
    fulfillment: DealProductFulfillment,
  ): Promise<Product> {
    const product = await this.internalHttp.getProduct(dto.productId);
    if (!product) {
      throw new BadRequestException(
        `Product "${dto.name}" was not found in inventory`,
      );
    }
    const isService = product.type === ProductType.SERVICE;
    if (isService && fulfillment !== 'service') {
      throw new BadRequestException(
        `"${dto.name}" is a service and must be added as a service line`,
      );
    }
    if (!isService && fulfillment === 'service') {
      throw new BadRequestException(
        `"${dto.name}" is a stockable product and cannot be added as a service line`,
      );
    }
    return product;
  }

  async addProduct(id: string, dto: AddDealProductDto, caller: JwtUser): Promise<void> {
    const deal = await this.findById(id);
    const fulfillment: DealProductFulfillment = dto.fulfillment ?? 'sourced';

    const product = await this.validateProductFulfillment(dto, fulfillment);

    // Only `sourced` lines are pulled from a technician's container and deduct
    // stock. `to_order` (a part the tech doesn't carry) and `service` (labor)
    // lines never touch inventory and don't require an assigned technician.
    if (fulfillment === 'sourced') {
      if (deal.assignedTechIds.length === 0) {
        throw new BadRequestException(
          'Cannot add products without an assigned technician',
        );
      }
      if (!dto.sourceTechId || !deal.assignedTechIds.includes(dto.sourceTechId)) {
        throw new BadRequestException(
          'The chosen technician is not assigned to this deal',
        );
      }

      // Deduct from that tech's container. A 4xx here (e.g. the tech doesn't
      // carry enough of this product) is a client error, not a server fault —
      // surface it as a clear message referencing the product by name.
      try {
        await this.internalHttp.deductStock({
          containerId: dto.sourceTechId,
          items: [{ productId: dto.productId, productName: dto.name, quantity: dto.quantity }],
          dealId: id,
          performedBy: caller.id,
          performedByName: caller.email,
        });
      } catch (error) {
        if (
          error instanceof HttpException &&
          error.getStatus() >= 400 &&
          error.getStatus() < 500
        ) {
          throw new BadRequestException(
            `The selected technician doesn't have enough "${dto.name}" in their container to add to this deal.`,
          );
        }
        throw error;
      }
    }

    this.businessMetrics?.dealProductsAdded.inc();
    await this.productsRepo.addProduct(id, {
      productId: dto.productId,
      name: dto.name,
      sku: dto.sku,
      quantity: dto.quantity,
      costCompany: dto.costCompany,
      costForTech: dto.costForTech,
      priceClient: dto.priceClient,
      fulfillment,
      // Only a sourced line records which technician supplied it.
      ...(fulfillment === 'sourced' && { sourceTechId: dto.sourceTechId }),
      // Absent on the request → the catalog product's default (itself absent → taxable).
      taxable: dto.taxable ?? product.taxable ?? true,
      ...(dto.description !== undefined && { description: dto.description }),
      addedBy: caller.id,
      addedAt: new Date().toISOString(),
    });

    await this.syncItemCount(id);
    await this.cache.invalidate(id);

    await this.addTimelineEntry(id, TimelineEventType.PRODUCT_ADDED, caller, {
      productId: dto.productId,
      productName: dto.name,
      quantity: dto.quantity,
      fulfillment,
    });

    this.publishEvent('deal.product_added', {
      dealId: id,
      productId: dto.productId,
      quantity: dto.quantity,
      fulfillment,
    });
  }

  /**
   * Replace a line item in place — edit its quantity/price or swap it for a
   * different catalog product. The dto is the complete new line. Stock is
   * reconciled restore-first: the old sourced line goes back to its source
   * technician before the new sourced line is deducted, so raising a quantity
   * only needs the delta in the van. If the new deduction is refused, the
   * restore is compensated (re-deducted) so containers end where they started.
   */
  async replaceProduct(
    id: string,
    productId: string,
    dto: AddDealProductDto,
    caller: JwtUser,
  ): Promise<void> {
    const deal = await this.findById(id);

    const existing = await this.productsRepo.findProduct(id, productId);
    if (!existing) {
      throw new NotFoundException(`Product ${productId} not found on deal ${id}`);
    }

    const fulfillment: DealProductFulfillment = dto.fulfillment ?? 'sourced';
    const isSwap = dto.productId !== productId;

    // A deal keys one line per product — swapping onto a product that already
    // has its own line would silently merge the two rows.
    if (isSwap && (await this.productsRepo.findProduct(id, dto.productId))) {
      throw new BadRequestException(
        `"${dto.name}" is already on this deal — edit that line instead`,
      );
    }

    const product = await this.validateProductFulfillment(dto, fulfillment);

    if (fulfillment === 'sourced') {
      if (deal.assignedTechIds.length === 0) {
        throw new BadRequestException(
          'Cannot add products without an assigned technician',
        );
      }
      if (!dto.sourceTechId || !deal.assignedTechIds.includes(dto.sourceTechId)) {
        throw new BadRequestException(
          'The chosen technician is not assigned to this deal',
        );
      }
    }

    // Same restore-target rule as removeProduct: legacy sourced rows without a
    // recorded source fall back to the sole assigned tech, if any.
    const restoreTo =
      (existing.fulfillment ?? 'sourced') === 'sourced'
        ? existing.sourceTechId ??
          (deal.assignedTechIds.length === 1 ? deal.assignedTechIds[0] : undefined)
        : undefined;
    const oldItems = [
      { productId: existing.productId, productName: existing.name, quantity: existing.quantity },
    ];
    const stockMeta = { dealId: id, performedBy: caller.id, performedByName: caller.email };

    if (restoreTo) {
      await this.internalHttp.restoreStock({ containerId: restoreTo, items: oldItems, ...stockMeta });
    }

    if (fulfillment === 'sourced') {
      try {
        await this.internalHttp.deductStock({
          containerId: dto.sourceTechId!,
          items: [{ productId: dto.productId, productName: dto.name, quantity: dto.quantity }],
          ...stockMeta,
        });
      } catch (error) {
        // Undo the restore so the van holds exactly what it did before the edit.
        if (restoreTo) {
          await this.internalHttp.deductStock({ containerId: restoreTo, items: oldItems, ...stockMeta });
        }
        if (
          error instanceof HttpException &&
          error.getStatus() >= 400 &&
          error.getStatus() < 500
        ) {
          throw new BadRequestException(
            `The selected technician doesn't have enough "${dto.name}" in their container to add to this deal.`,
          );
        }
        throw error;
      }
    }

    // An in-place edit keeps the line's own taxable/description (a user may have
    // toggled it); a swap starts from the new catalog product's default.
    const taxable = dto.taxable ?? (isSwap ? product.taxable : existing.taxable) ?? true;
    const description = dto.description ?? (isSwap ? undefined : existing.description);

    if (isSwap) {
      await this.productsRepo.removeProduct(id, productId);
    }
    await this.productsRepo.addProduct(id, {
      productId: dto.productId,
      name: dto.name,
      sku: dto.sku,
      quantity: dto.quantity,
      costCompany: dto.costCompany,
      costForTech: dto.costForTech,
      priceClient: dto.priceClient,
      fulfillment,
      // Only a sourced line records which technician supplied it.
      ...(fulfillment === 'sourced' && { sourceTechId: dto.sourceTechId }),
      // An in-place to-order edit keeps its ordered stamp; a swap starts fresh.
      ...(!isSwap &&
        fulfillment === 'to_order' &&
        existing.orderedAt && { orderedAt: existing.orderedAt }),
      taxable,
      ...(description !== undefined && { description }),
      addedBy: existing.addedBy,
      addedAt: existing.addedAt,
      updatedBy: caller.id,
      updatedAt: new Date().toISOString(),
    });

    await this.syncItemCount(id);
    await this.cache.invalidate(id);

    // Money/quantity edits, old → new, so the timeline can say exactly what
    // changed on the line (price, costs, qty) — not just that it was touched.
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of ['priceClient', 'costCompany', 'costForTech', 'quantity'] as const) {
      if (existing[k] !== dto[k]) changes[k] = { from: existing[k], to: dto[k] };
    }

    await this.addTimelineEntry(id, TimelineEventType.PRODUCT_UPDATED, caller, {
      productId: dto.productId,
      productName: dto.name,
      previousProductId: existing.productId,
      previousProductName: existing.name,
      quantity: dto.quantity,
      fulfillment,
      changes,
    });

    this.publishEvent('deal.product_updated', {
      dealId: id,
      productId: dto.productId,
      previousProductId: existing.productId,
      quantity: dto.quantity,
      fulfillment,
    });
  }

  async removeProduct(id: string, productId: string, caller: JwtUser): Promise<void> {
    const deal = await this.findById(id);

    const product = await this.productsRepo.findProduct(id, productId);
    if (!product) {
      throw new NotFoundException(`Product ${productId} not found on deal ${id}`);
    }

    // Only sourced lines deducted stock, so only they restore it. `to_order` and
    // `service` lines never touched inventory. Legacy rows (no `fulfillment`)
    // are treated as sourced by the repository mapper.
    if (product.fulfillment === 'sourced') {
      // Restore to the container the line was pulled from. Legacy sourced rows
      // without a recorded source fall back to the sole assigned tech, if any.
      const restoreTo =
        product.sourceTechId ??
        (deal.assignedTechIds.length === 1 ? deal.assignedTechIds[0] : undefined);
      if (restoreTo) {
        await this.internalHttp.restoreStock({
          containerId: restoreTo,
          items: [{ productId: product.productId, productName: product.name, quantity: product.quantity }],
          dealId: id,
          performedBy: caller.id,
          performedByName: caller.email,
        });
      }
    }

    await this.productsRepo.removeProduct(id, productId);
    await this.syncItemCount(id);
    await this.cache.invalidate(id);

    await this.addTimelineEntry(id, TimelineEventType.PRODUCT_REMOVED, caller, {
      productId: product.productId,
      productName: product.name,
    });

    this.publishEvent('deal.product_removed', {
      dealId: id,
      productId,
    });
  }

  /**
   * Mark a to-order line as ordered (or clear it). Only `to_order` lines carry
   * an order status; sourced/service lines have nothing to order.
   */
  async markProductOrdered(
    id: string,
    productId: string,
    ordered: boolean,
    caller: JwtUser,
  ): Promise<void> {
    const product = await this.productsRepo.findProduct(id, productId);
    if (!product) {
      throw new NotFoundException(`Product ${productId} not found on deal ${id}`);
    }
    if (product.fulfillment !== 'to_order') {
      throw new BadRequestException(
        'Only items that need ordering can be marked as ordered',
      );
    }

    const orderedAt = ordered ? new Date().toISOString() : null;
    await this.productsRepo.setOrderedAt(id, productId, orderedAt);
    await this.cache.invalidate(id);

    await this.addTimelineEntry(id, TimelineEventType.FIELD_UPDATED, caller, {
      field: `product.${productId}.ordered`,
      newValue: ordered,
    });
  }

  async getProducts(id: string) {
    await this.findById(id);
    return this.productsRepo.findByDeal(id);
  }

  // Internal endpoints (service-to-service)
  async getTechDeals(techId: string) {
    return this.repository.findByTech(techId, 100);
  }

  /** Thin passthrough for the search-service backfill/indexer. */
  async findAll(limit: number, cursor?: string) {
    return this.repository.findAll(limit, cursor);
  }

  /**
   * Re-points every active deal of `oldContactId` to `newContactId` after a
   * CRM contact merge (consumed from the `contact.merged` event). Deleted
   * deals keep the old id — the merged contact stays in DynamoDB soft-deleted,
   * so those references still resolve.
   */
  async reassignContact(oldContactId: string, newContactId: string): Promise<number> {
    let cursor: string | undefined;
    let count = 0;

    do {
      const page = await this.repository.findByContact(oldContactId, 100, cursor);
      for (const deal of page.items) {
        await this.repository.reassignContact(deal.id, newContactId);
        await this.cache.invalidate(deal.id);
        await this.timelineRepo.addEntry({
          id: randomUUID(),
          dealId: deal.id,
          eventType: TimelineEventType.FIELD_UPDATED,
          actorId: 'system',
          actorName: 'CRM Service',
          timestamp: new Date().toISOString(),
          details: {
            field: 'contactId',
            oldValue: oldContactId,
            newValue: newContactId,
          },
        });
        count++;
      }
      cursor = page.nextCursor;
    } while (cursor);

    return count;
  }

  async updatePaymentStatus(id: string, dto: UpdatePaymentStatusDto): Promise<void> {
    await this.repository.update(id, {
      paymentStatus: 'paid',
      actualTotal: dto.amount,
    } as any);
    await this.cache.invalidate(id);

    await this.timelineRepo.addEntry({
      id: randomUUID(),
      dealId: id,
      eventType: TimelineEventType.FIELD_UPDATED,
      actorId: 'system',
      actorName: 'Payment Service',
      timestamp: new Date().toISOString(),
      details: {
        field: 'paymentStatus',
        newValue: 'paid',
        paymentId: dto.paymentId,
        amount: dto.amount,
      },
    });
    this.publishEvent('deal.updated', { dealId: id });
  }

  // Private helpers

  /**
   * Structural equality for timeline diffing (primitives, arrays, plain
   * objects). Undefined-valued keys are ignored so a re-sent object that merely
   * omits optional keys isn't logged as a change.
   */
  private valuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((v, i) => this.valuesEqual(v, b[i]));
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const objA = a as Record<string, unknown>;
      const objB = b as Record<string, unknown>;
      const keysA = Object.keys(objA).filter((k) => objA[k] !== undefined);
      const keysB = Object.keys(objB).filter((k) => objB[k] !== undefined);
      return (
        keysA.length === keysB.length &&
        keysA.every((k) => this.valuesEqual(objA[k], objB[k]))
      );
    }
    return false;
  }

  private async addTimelineEntry(
    dealId: string,
    eventType: TimelineEventType,
    caller: JwtUser,
    details: Record<string, unknown>,
    note?: string,
  ): Promise<void> {
    const entry: TimelineEntry = {
      id: randomUUID(),
      dealId,
      eventType,
      actorId: caller.id,
      actorName: caller.email,
      timestamp: new Date().toISOString(),
      details,
      note,
    };
    await this.timelineRepo.addEntry(entry);
  }

  private publishEvent(eventType: string, payload: Record<string, unknown>): void {
    this.snsPublisher?.publish('deal-events', eventType, payload)
      .then(() => this.businessMetrics?.eventsPublished.inc({ event_type: eventType }))
      .catch((error: any) => {
        this.businessMetrics?.eventsFailed.inc({ event_type: eventType });
        this.logger.warn(`Failed to publish ${eventType}: ${error.message}`);
      });
  }
}
