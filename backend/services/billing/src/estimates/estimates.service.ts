import { RedisService, cachedCount, countCacheKey } from '@bitcrm/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  BillingEventType,
  ESTIMATE_STATUSES,
  ProductType,
  TimelineEventType,
  effectiveTaxRatePercent,
  type DealProduct,
  type DocumentDiscount,
  type Estimate,
  type EstimateItem,
  type EstimateStatus,
  type EstimateWithItems,
  type ListCount,
  type DocumentVisibility,
} from '@bitcrm/types';
import { assertDealAccess, isAssignedOnly, type Caller } from '../common/access';
import { isYmd, resolveTimezone, todayIn } from '../common/dates';
import { standaloneDocumentNumber } from '../common/document-number';
import { AssetsService } from '../assets/assets.service';
import { DocumentSettingsService } from '../documents/document-settings.service';
import { SignaturesService } from '../signatures/signatures.service';
import { DocumentsService } from '../documents/documents.service';
import { BillingEventsPublisher } from '../integrations/billing-events.publisher';
import { CrmClient } from '../integrations/crm.client';
import { DealClient, type DealBillingView, type ReplaceAllRequest } from '../integrations/deal.client';
import {
  assertSyncable,
  estimateNumber,
  estimateTotals,
  markSentChanges,
  reorderPositions,
  sortItems,
  statusChanges,
  assertClientCanDecide,
  depositChanges,
  displayOverrides,
} from './estimate-rules';
import {
  EstimateVersionConflictError,
  EstimatesRepository,
  type EstimateListFilter,
} from './estimates.repository';

/** Either a job (`dealId`) or a client alone (`contactId`) — see `Estimate`. */
export interface CreateEstimateInput {
  dealId?: string;
  contactId?: string;
  name?: string;
  copyJobItems?: boolean;
}

/** A signature from the portal canvas (or the technician's phone). */
export interface SignEstimateInput {
  imageDataUrl: string;
  signedBy: string;
  ip?: string;
}

export interface UpdateEstimateInput {
  name?: string | null;
  estimateDate?: string;
  notes?: string | null;
  /** Workiz proposal option: the pitch under the title. */
  description?: string | null;
  /** Workiz proposal option: the cover image — a billing asset that finished uploading. `null` removes it. */
  coverAssetId?: string | null;
  /** Workiz "Set deposit": a percent of the total OR a fixed amount; `null` clears. */
  depositPercentage?: number | null;
  depositAmount?: number | null;
  /** Workiz Send panel "Advanced": which details the client sees; `null` = the template's own. */
  display?: Partial<DocumentVisibility> | null;
  templateId?: string | null;
  taxRateId?: string | null;
  discount?: DocumentDiscount | null;
}

export interface EstimateItemInput {
  productId: string;
  productType?: ProductType;
  name: string;
  sku: string;
  description?: string;
  quantity: number;
  priceClient: number;
  costCompany: number;
  costForTech: number;
  taxable?: boolean;
}

export type EstimateSummary = Record<EstimateStatus, { count: number; amount: number }> & {
  total: { count: number; amount: number };
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Estimates (Workiz): many per job, own line items, own tax/discount
 * snapshot. `sync-to-job` overwrites the job's items through deal-service.
 *
 * An estimate may also belong to a CLIENT with no job (the client card's
 * Create new → Estimate). Such an estimate has no `dealId`: nothing is read
 * from or written to deal-service for it, its number comes from the account
 * counter, it is office-only (a technician's `assigned_only` scope is about
 * jobs), and Sync to job is refused until it has a job.
 */
/** How long a list count stays good enough. Matches the deals tab counts. */
const COUNT_TTL_SECONDS = 30;

@Injectable()
export class EstimatesService {
  private readonly logger = new Logger(EstimatesService.name);

  constructor(
    private readonly repo: EstimatesRepository,
    private readonly deal: DealClient,
    @Optional() private readonly documents?: DocumentsService,
    @Optional() private readonly events?: BillingEventsPublisher,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly crm?: CrmClient,
    @Optional() private readonly documentSettings?: DocumentSettingsService,
    @Optional() private readonly signatures?: SignaturesService,
    @Optional() private readonly assets?: AssetsService,
  ) {}

  /** The cover image's short-lived URL, when one is set and assets are wired. */
  private async coverOf(estimate: Pick<Estimate, 'coverAssetId'>): Promise<Pick<EstimateWithItems, 'coverUrl'>> {
    if (!estimate.coverAssetId || !this.assets) return {};
    try {
      return { coverUrl: (await this.assets.getUrl(estimate.coverAssetId)).url };
    } catch (err) {
      this.logger.warn(`estimate cover ${estimate.coverAssetId} unreadable: ${(err as Error).message}`);
      return {};
    }
  }

  // ---------------------------------------------------------------- create

  /**
   * What every NEW estimate starts with (Workiz: Settings → Documents and the
   * deposit's "Set for future estimates"): the default Notes and the default
   * deposit. Best effort — unreadable settings just mean a blank start.
   */
  private async newEstimateDefaults(): Promise<Pick<Estimate, 'notes' | 'depositPercentage' | 'depositAmount'>> {
    if (!this.documentSettings) return {};
    try {
      const s = await this.documentSettings.get();
      return {
        ...(s.estimateNotes?.trim() && { notes: s.estimateNotes.trim() }),
        ...(s.depositPercentage && { depositPercentage: s.depositPercentage }),
        ...(s.depositAmount && { depositAmount: s.depositAmount }),
      };
    } catch (err) {
      this.logger.warn(`document settings unavailable, creating a blank estimate: ${(err as Error).message}`);
      return {};
    }
  }

  async create(input: CreateEstimateInput, caller: Caller): Promise<EstimateWithItems> {
    if (input.dealId) return this.createForJob(input.dealId, input, caller);
    if (input.contactId) return this.createForClient(input.contactId, input, caller);
    throw new BadRequestException('An estimate needs a job (dealId) or a client (contactId)');
  }

  /**
   * A client's estimate with no job (Workiz's "stub"): numbered from the
   * account counter, Bill to = the client, tax exempt when the client is,
   * empty items. Office-only — a technician has no job to be assigned to.
   */
  private async createForClient(contactId: string, input: CreateEstimateInput, caller: Caller): Promise<EstimateWithItems> {
    if (isAssignedOnly(caller, 'estimates')) {
      throw new ForbiddenException('An estimate without a job can only be created from the office');
    }
    const contact = await this.requireCrm().getContact(contactId);
    if (!contact) throw new NotFoundException('Client not found');
    const seq = await this.repo.nextAccountSeq();
    const now = new Date().toISOString();
    const id = randomUUID();
    const estimate: Estimate = {
      id,
      number: standaloneDocumentNumber(seq),
      contactId: contact.id,
      ...(contact.companyId && { companyId: contact.companyId }),
      ...(input.name?.trim() && { name: input.name.trim() }),
      status: 'unsent',
      statusChangedAt: now,
      estimateDate: todayIn(resolveTimezone(undefined)),
      ...(contact.taxExempt && { taxRatePercent: 0, taxSource: 'exempt' as const }),
      ...(await this.newEstimateDefaults()),
      totals: estimateTotals({}, []),
      version: 1,
      createdBy: caller.user.id,
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.create(estimate, []);
    this.events?.estimate(BillingEventType.ESTIMATE_CREATED, estimate);
    return { ...estimate, items: [] };
  }

  private async createForJob(dealId: string, input: CreateEstimateInput, caller: Caller): Promise<EstimateWithItems> {
    const view = await this.loadView(dealId);
    assertDealAccess(caller, 'estimates', view.deal);
    const d = view.deal;
    const seq = await this.repo.nextSeq(d.id);
    const now = new Date().toISOString();
    const tz = await this.timezoneFor(d.serviceAreaId);
    const id = randomUUID();

    const estimate: Estimate = {
      id,
      number: estimateNumber(d.dealNumber, seq),
      dealId: d.id,
      dealNumber: d.dealNumber,
      contactId: d.contactId,
      ...(d.companyId && { companyId: d.companyId }),
      ...(input.name?.trim() && { name: input.name.trim() }),
      status: 'unsent',
      statusChangedAt: now,
      estimateDate: todayIn(tz),
      ...(d.taxRateId && { taxRateId: d.taxRateId }),
      ...(d.taxRateName && { taxRateName: d.taxRateName }),
      ...(d.taxRatePercent !== undefined && { taxRatePercent: d.taxRatePercent }),
      ...(d.taxSource && { taxSource: d.taxSource }),
      ...(d.discount && { discount: d.discount }),
      ...(await this.newEstimateDefaults()),
      totals: estimateTotals({}, []),
      version: 1,
      createdBy: caller.user.id,
      createdAt: now,
      updatedAt: now,
    };
    const items = input.copyJobItems ? view.items.map((p, i) => this.fromJobLine(id, p, i, now)) : [];
    estimate.totals = estimateTotals(estimate, items);

    await this.repo.create(estimate, items);
    await this.deal.addTimeline(d.id, TimelineEventType.ESTIMATE_CREATED, caller.user.id, {
      estimateId: id,
      number: estimate.number,
      total: estimate.totals.total,
    }, caller.user.email);
    this.events?.estimate(BillingEventType.ESTIMATE_CREATED, estimate);
    return { ...estimate, items };
  }

  /**
   * Workiz "Copy to job" on a standalone estimate: the estimate's lines
   * become the job's items (like a sync), the estimate joins that job
   * (numbered as it was, under the job's Estimates tab) and is `won`. The job
   * must be the same client's; an estimate already on a job is synced, not copied.
   */
  async copyToJob(id: string, dealId: string, caller: Caller): Promise<{ estimate: EstimateWithItems; itemCount: number }> {
    const { estimate, items } = await this.load(id, caller);
    if (estimate.dealId) {
      throw new ConflictException('This estimate already belongs to a job — use Sync to job instead');
    }
    const view = await this.loadView(dealId);
    assertDealAccess(caller, 'estimates', view.deal);
    if (view.deal.contactId !== estimate.contactId) {
      throw new ConflictException("That job belongs to another client — pick one of this client's jobs");
    }
    assertSyncable(estimate, items.length);
    const result = await this.deal.replaceAllProducts(dealId, this.replaceAllBody(estimate, items, caller));

    const now = new Date().toISOString();
    const updated = await this.write(
      id,
      {
        ...statusChanges(estimate, 'won', now),
        dealId,
        dealNumber: view.deal.dealNumber,
        // Needed by the repository to file the row under the job's DealIndex partition.
        createdAt: estimate.createdAt,
        syncedAt: now,
        syncedBy: caller.user.id,
        updatedAt: now,
      },
      [],
      estimate.version,
    );
    await this.timeline(dealId, TimelineEventType.ESTIMATE_SYNCED, caller, {
      estimateId: id,
      number: estimate.number,
      itemCount: items.length,
      copiedFromClient: true,
    });
    this.events?.estimate(BillingEventType.ESTIMATE_SYNCED, updated);
    return { estimate: { ...updated, items }, itemCount: result.items?.length ?? items.length };
  }

  /** The job's new lines, tax and discount as the estimate has them (shared by sync and copy). */
  private replaceAllBody(estimate: Estimate, items: EstimateItem[], caller: Caller): ReplaceAllRequest {
    return {
      actorId: caller.user.id,
      actorName: caller.user.email,
      estimateNumber: estimate.number,
      items: items.map((i) => ({
        productId: i.productId,
        ...(i.productType && { productType: i.productType }),
        name: i.name,
        sku: i.sku,
        ...(i.description && { description: i.description }),
        quantity: i.quantity,
        priceClient: i.priceClient,
        costCompany: i.costCompany,
        costForTech: i.costForTech,
        taxable: i.taxable,
      })),
      // An exempt estimate says nothing about the job's rate: leave the job's
      // own resolution (which is exempt for the same client) alone.
      ...(estimate.taxSource !== 'exempt' && { taxRateId: estimate.taxRateId ?? null }),
      // Lets deal-service keep a pre-Revision-2 (catalog) rate that no longer resolves.
      ...(estimate.taxSource !== 'exempt' &&
        estimate.taxRateId &&
        estimate.taxRateName && {
          taxRateName: estimate.taxRateName,
          taxRatePercent: estimate.taxRatePercent ?? 0,
        }),
      discount: estimate.discount ?? null,
    };
  }

  async duplicate(id: string, caller: Caller): Promise<EstimateWithItems> {
    const src = await this.load(id, caller);
    const { dealId, dealNumber } = src.estimate;
    const number =
      dealId && dealNumber
        ? estimateNumber(dealNumber, await this.repo.nextSeq(dealId))
        : standaloneDocumentNumber(await this.repo.nextAccountSeq());
    const now = new Date().toISOString();
    const newId = randomUUID();
    const {
      sentAt: _sentAt,
      sentBy: _sentBy,
      approvedAt: _a,
      declinedAt: _d,
      wonAt: _w,
      syncedAt: _s,
      syncedBy: _sb,
      ...rest
    } = src.estimate;
    const copy: Estimate = {
      ...rest,
      id: newId,
      number,
      status: 'unsent',
      statusChangedAt: now,
      version: 1,
      createdBy: caller.user.id,
      createdAt: now,
      updatedAt: now,
    };
    const items = src.items.map((i, position) => ({
      ...i,
      lineId: randomUUID(),
      estimateId: newId,
      position,
      createdAt: now,
      updatedAt: now,
    }));
    copy.totals = estimateTotals(copy, items);
    await this.repo.create(copy, items);
    await this.timeline(copy.dealId, TimelineEventType.ESTIMATE_CREATED, caller, {
      estimateId: newId,
      number: copy.number,
      duplicatedFrom: src.estimate.number,
    });
    this.events?.estimate(BillingEventType.ESTIMATE_CREATED, copy);
    return { ...copy, items };
  }

  // ------------------------------------------------------------------ read

  async get(id: string, caller: Caller): Promise<EstimateWithItems> {
    const { estimate, items } = await this.load(id, caller);
    return { ...estimate, items, ...(await this.signaturesOf(id)), ...(await this.coverOf(estimate)) };
  }

  /** The document's signatures, oldest first — absent when signatures are not wired. */
  private async signaturesOf(id: string): Promise<Pick<EstimateWithItems, 'signatures'>> {
    if (!this.signatures) return {};
    return { signatures: await this.signatures.list('estimate', id) };
  }

  getStored(id: string): Promise<Estimate | null> {
    return this.repo.getMetadata(id);
  }

  listForContact(contactId: string): Promise<Estimate[]> {
    return this.repo.list({ contactId, limit: 200 }).then((r) => r.items);
  }

  async listByDeal(dealId: string, caller: Caller): Promise<EstimateWithItems[]> {
    if (isAssignedOnly(caller, 'estimates')) {
      const view = await this.loadView(dealId);
      assertDealAccess(caller, 'estimates', view.deal);
    }
    const metas = await this.repo.listByDeal(dealId);
    const full = await Promise.all(metas.map((m) => this.repo.get(m.id)));
    return full
      .filter((f): f is NonNullable<typeof f> => !!f)
      .map((f) => ({ ...f.estimate, items: f.items }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async list(
    query: Omit<EstimateListFilter, 'limit'> & { limit?: number },
    caller: Caller,
  ): Promise<{ items: Estimate[]; nextCursor?: string }> {
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const result = await this.repo.list({ ...query, limit });
    if (!isAssignedOnly(caller, 'estimates')) return result;
    // Page-local filter (see InvoicesService.list). A client estimate has no
    // job to be assigned to, so a technician never sees one.
    const mine = await this.deal.listDealIdsByTech(caller.user.id);
    return { ...result, items: result.items.filter((e) => onMyJobs(e, mine)) };
  }

  /**
   * How many estimates the filter selects — the number behind "Page 2 of 7".
   * A technician scoped to their own jobs gets `null`, for the same reason as
   * invoices: their page is filtered after the query (see InvoicesService).
   */
  async count(
    query: Omit<EstimateListFilter, 'limit'>,
    caller: Caller,
  ): Promise<ListCount> {
    if (isAssignedOnly(caller, 'estimates')) return { total: null, atLeast: false };

    const take = () => this.repo.count({ ...query, limit: 1 } as EstimateListFilter);
    if (!this.redis) return take();
    return cachedCount(
      this.redis.client,
      countCacheKey('estimates', {
        dealId: query.dealId,
        contactId: query.contactId,
        status: query.status,
      }),
      COUNT_TTL_SECONDS,
      take,
    );
  }

  async summary(caller: Caller): Promise<EstimateSummary> {
    let all = await this.repo.listAll();
    if (isAssignedOnly(caller, 'estimates')) {
      const mine = await this.deal.listDealIdsByTech(caller.user.id);
      all = all.filter((e) => onMyJobs(e, mine));
    }
    const out = Object.fromEntries(
      [...ESTIMATE_STATUSES, 'total'].map((s) => [s, { count: 0, amount: 0 }]),
    ) as EstimateSummary;
    for (const e of all) {
      const bucket = out[e.status as EstimateStatus];
      const amount = e.totals?.total ?? 0;
      if (bucket) {
        bucket.count++;
        bucket.amount = round2(bucket.amount + amount);
      }
      out.total.count++;
      out.total.amount = round2(out.total.amount + amount);
    }
    return out;
  }

  // ----------------------------------------------------------------- write

  async update(id: string, input: UpdateEstimateInput, caller: Caller): Promise<EstimateWithItems> {
    const { estimate, items } = await this.load(id, caller);
    if (input.estimateDate !== undefined && !isYmd(input.estimateDate)) {
      throw new BadRequestException('estimateDate must be YYYY-MM-DD');
    }
    const set: Partial<Estimate> = { updatedAt: new Date().toISOString() };
    const remove: string[] = [];
    const optional = (key: 'name' | 'notes' | 'templateId' | 'description', value: string | null | undefined) => {
      if (value === undefined) return;
      if (value === null || value.trim() === '') remove.push(key);
      else set[key] = value.trim();
    };
    optional('name', input.name);
    optional('notes', input.notes);
    optional('templateId', input.templateId);
    optional('description', input.description);
    if (input.coverAssetId !== undefined) {
      if (input.coverAssetId === null || input.coverAssetId === '') remove.push('coverAssetId');
      else {
        if (!this.assets) throw new UnprocessableEntityException('Images are not available');
        try {
          await this.assets.getUrl(input.coverAssetId);
        } catch {
          throw new BadRequestException('The cover image was not uploaded — upload it first, then save');
        }
        set.coverAssetId = input.coverAssetId;
      }
    }
    if (input.estimateDate !== undefined) set.estimateDate = input.estimateDate;
    const deposit = depositChanges(input);
    Object.assign(set, deposit.set);
    remove.push(...deposit.remove);
    if (input.display !== undefined) {
      const display = displayOverrides(input.display);
      if (display) set.display = display;
      else remove.push('display');
    }

    if (input.taxRateId !== undefined) {
      if (input.taxRateId === null) {
        remove.push('taxRateId', 'taxRateName');
        set.taxRatePercent = 0;
        set.taxSource = 'manual';
      } else {
        const rates = await this.deal.listTaxRates();
        const rate = rates.find((r) => r.id === input.taxRateId);
        if (!rate) throw new NotFoundException('Tax rate not found');
        set.taxRateId = rate.id;
        set.taxRateName = rate.name;
        set.taxRatePercent = effectiveTaxRatePercent(rate, rates);
        set.taxSource = 'manual';
      }
    }
    if (input.discount !== undefined) {
      if (input.discount === null || !(input.discount.value > 0)) remove.push('discount');
      else set.discount = { type: input.discount.type, value: input.discount.value };
    }
    // Re-priced here: Workiz's own Amount no longer describes it.
    if ((input.taxRateId !== undefined || input.discount !== undefined) && estimate.workizTotal !== undefined) {
      remove.push('workizTotal');
    }

    const next = { ...estimate, ...set } as Estimate;
    for (const k of remove) delete (next as unknown as Record<string, unknown>)[k];
    set.totals = estimateTotals(next, items);

    const updated = await this.write(id, set, remove, estimate.version);
    this.events?.estimate(BillingEventType.ESTIMATE_UPDATED, updated);
    return { ...updated, items, ...(await this.coverOf(updated)) };
  }

  async setStatus(id: string, status: EstimateStatus, caller: Caller): Promise<EstimateWithItems> {
    const { estimate, items } = await this.load(id, caller);
    const changes = statusChanges(estimate, status, new Date().toISOString());
    if (!Object.keys(changes).length) return { ...estimate, items };
    const updated = await this.write(id, { ...changes, updatedAt: changes.statusChangedAt }, [], estimate.version);
    await this.timeline(estimate.dealId, TimelineEventType.ESTIMATE_STATUS_CHANGED, caller, {
      estimateId: id,
      number: estimate.number,
      from: estimate.status,
      to: status,
    });
    this.events?.estimate(BillingEventType.ESTIMATE_UPDATED, updated);
    return { ...updated, items };
  }

  // ------------------------------------------------- client decisions (portal)

  /**
   * The client approves the estimate on the portal (Workiz): the signature is
   * mandatory and is taken FIRST — no signature, no approval — then the
   * status becomes `approved`. The deposit, when there is one, is collected
   * right after by the payments flow; it never gates the approval here.
   */
  async approveByClient(id: string, input: SignEstimateInput): Promise<EstimateWithItems> {
    const found = await this.repo.get(id);
    if (!found) throw new NotFoundException('Estimate not found');
    const { estimate, items } = found;
    assertClientCanDecide(estimate);
    const signatures = this.requireSignatures();
    const signature = await signatures.collect({
      kind: 'estimate',
      documentId: id,
      ...(estimate.dealId && { dealId: estimate.dealId }),
      contactId: estimate.contactId,
      imageDataUrl: input.imageDataUrl,
      signedBy: input.signedBy,
      source: 'portal',
      ...(input.ip && { ip: input.ip }),
    });
    const now = new Date().toISOString();
    const updated = await this.write(
      id,
      { ...statusChanges(estimate, 'approved', now), approvedVia: 'portal', signedAt: signature.signedAt, updatedAt: now },
      [],
      estimate.version,
    );
    await this.clientTimeline(estimate.dealId, TimelineEventType.ESTIMATE_APPROVED, signature.signedBy, {
      estimateId: id,
      number: estimate.number,
      total: estimate.totals.total,
      signedBy: signature.signedBy,
      signatureId: signature.id,
    });
    this.events?.estimate(BillingEventType.ESTIMATE_UPDATED, updated);
    return { ...updated, items, signatures: await signatures.list('estimate', id) };
  }

  /** The client declines on the portal, optionally saying why. No signature involved. */
  async declineByClient(id: string, input: { reason?: string }): Promise<EstimateWithItems> {
    const found = await this.repo.get(id);
    if (!found) throw new NotFoundException('Estimate not found');
    const { estimate, items } = found;
    assertClientCanDecide(estimate);
    const now = new Date().toISOString();
    const reason = input.reason?.trim();
    const updated = await this.write(
      id,
      { ...statusChanges(estimate, 'declined', now), ...(reason && { declineReason: reason }), updatedAt: now },
      reason ? [] : ['declineReason'],
      estimate.version,
    );
    await this.clientTimeline(estimate.dealId, TimelineEventType.ESTIMATE_DECLINED, undefined, {
      estimateId: id,
      number: estimate.number,
      ...(reason && { reason }),
    });
    this.events?.estimate(BillingEventType.ESTIMATE_UPDATED, updated);
    return { ...updated, items, ...(await this.signaturesOf(id)) };
  }

  /**
   * A signature collected in person (the technician's phone, Workiz
   * "Signatures +"). It is evidence only: the status is the office's call.
   */
  async sign(id: string, input: SignEstimateInput, caller: Caller): Promise<EstimateWithItems> {
    const { estimate, items } = await this.load(id, caller);
    const signatures = this.requireSignatures();
    const signature = await signatures.collect({
      kind: 'estimate',
      documentId: id,
      ...(estimate.dealId && { dealId: estimate.dealId }),
      contactId: estimate.contactId,
      imageDataUrl: input.imageDataUrl,
      signedBy: input.signedBy,
      source: 'app',
      collectedBy: caller.user.id,
      ...(input.ip && { ip: input.ip }),
    });
    const updated = await this.write(
      id,
      { signedAt: signature.signedAt, updatedAt: signature.signedAt },
      [],
      estimate.version,
    );
    await this.timeline(estimate.dealId, TimelineEventType.ESTIMATE_STATUS_CHANGED, caller, {
      estimateId: id,
      number: estimate.number,
      signedBy: signature.signedBy,
      signatureId: signature.id,
      signed: true,
    });
    return { ...updated, items, signatures: await signatures.list('estimate', id) };
  }

  private requireSignatures(): SignaturesService {
    if (!this.signatures) throw new UnprocessableEntityException('Signatures are not available');
    return this.signatures;
  }

  /** A timeline entry whose actor is the client, not a staff user. */
  private async clientTimeline(
    dealId: string | undefined,
    type: TimelineEventType,
    clientName: string | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (!dealId) return;
    await this.deal.addTimeline(dealId, type, 'client', metadata, clientName);
  }

  async markSent(id: string, sent: boolean, caller: Caller): Promise<EstimateWithItems> {
    const { estimate, items } = await this.load(id, caller);
    const now = new Date().toISOString();
    const { set, remove } = markSentChanges(estimate, sent, caller.user.id, now);
    const updated = await this.write(id, { ...set, updatedAt: now }, remove, estimate.version);
    if (sent) {
      await this.timeline(estimate.dealId, TimelineEventType.ESTIMATE_SENT, caller, {
        estimateId: id,
        number: estimate.number,
      });
    }
    this.events?.estimate(BillingEventType.ESTIMATE_UPDATED, updated);
    return { ...updated, items };
  }

  /**
   * "Send all (proposal)": each option is marked sent (unsent → pending) and
   * remembers its proposal. One write per estimate, no timeline — the
   * proposal logs one entry for the lot.
   */
  async attachToProposal(estimateIds: string[], proposalId: string, caller: Caller): Promise<void> {
    const now = new Date().toISOString();
    for (const id of estimateIds) {
      const estimate = await this.repo.getMetadata(id);
      if (!estimate) continue;
      const { set } = markSentChanges(estimate, true, caller.user.id, now);
      const updated = await this.write(id, { ...set, proposalId, updatedAt: now }, [], estimate.version);
      this.events?.estimate(BillingEventType.ESTIMATE_UPDATED, updated);
    }
  }

  async delete(id: string, caller: Caller): Promise<void> {
    const { estimate } = await this.load(id, caller);
    await this.repo.delete(id);
    await this.timeline(estimate.dealId, TimelineEventType.ESTIMATE_DELETED, caller, {
      estimateId: id,
      number: estimate.number,
    });
    this.events?.estimate(BillingEventType.ESTIMATE_DELETED, estimate);
  }

  // ----------------------------------------------------------------- items

  async addItem(id: string, input: EstimateItemInput, caller: Caller): Promise<EstimateWithItems> {
    const { estimate, items } = await this.load(id, caller);
    const now = new Date().toISOString();
    const position = items.reduce((max, i) => Math.max(max, i.position), -1) + 1;
    await this.repo.putItem(this.toItem(id, randomUUID(), position, input, now, now));
    return this.recompute(estimate);
  }

  async updateItem(id: string, lineId: string, input: EstimateItemInput, caller: Caller): Promise<EstimateWithItems> {
    const { estimate, items } = await this.load(id, caller);
    const current = items.find((i) => i.lineId === lineId);
    if (!current) throw new NotFoundException('Estimate line not found');
    const next = this.toItem(id, lineId, current.position, input, current.createdAt, new Date().toISOString());
    if (input.taxable === undefined) next.taxable = current.taxable;
    await this.repo.putItem(next);
    return this.recompute(estimate);
  }

  async setItemTaxable(id: string, lineId: string, taxable: boolean, caller: Caller): Promise<EstimateWithItems> {
    const { estimate, items } = await this.load(id, caller);
    const current = items.find((i) => i.lineId === lineId);
    if (!current) throw new NotFoundException('Estimate line not found');
    await this.repo.putItem({ ...current, taxable, updatedAt: new Date().toISOString() });
    return this.recompute(estimate);
  }

  async removeItem(id: string, lineId: string, caller: Caller): Promise<EstimateWithItems> {
    const { estimate, items } = await this.load(id, caller);
    if (!items.some((i) => i.lineId === lineId)) throw new NotFoundException('Estimate line not found');
    await this.repo.deleteItem(id, lineId);
    return this.recompute(estimate);
  }

  async reorderItems(id: string, lineIds: string[], caller: Caller): Promise<EstimateWithItems> {
    const { estimate, items } = await this.load(id, caller);
    const moves = reorderPositions(items, lineIds);
    if (moves.length) await this.repo.setPositions(id, moves, new Date().toISOString());
    const byId = new Map(moves.map((m) => [m.lineId, m.position]));
    const reordered = sortItems(items.map((i) => ({ ...i, position: byId.get(i.lineId) ?? i.position })));
    return { ...estimate, items: reordered };
  }

  // ------------------------------------------------------------------ sync

  /**
   * Overwrites the job's items with the estimate's. A CLIENT estimate has no
   * job: that is a 409 — "create a job from this estimate" needs a deal-service
   * route that does not exist yet, so for now the job is created first (the
   * client card's Create new → Job) and its own estimates are synced.
   */
  async syncToJob(id: string, caller: Caller): Promise<{ estimate: EstimateWithItems; itemCount: number }> {
    const { estimate, items } = await this.load(id, caller);
    if (!estimate.dealId) {
      throw new ConflictException(
        'This estimate belongs to the client and has no job to sync to — create a job for the client first',
      );
    }
    assertSyncable(estimate, items.length);

    const result = await this.deal.replaceAllProducts(estimate.dealId, this.replaceAllBody(estimate, items, caller));

    const now = new Date().toISOString();
    const updated = await this.write(
      id,
      { ...statusChanges(estimate, 'won', now), syncedAt: now, syncedBy: caller.user.id, updatedAt: now },
      [],
      estimate.version,
    );
    this.events?.estimate(BillingEventType.ESTIMATE_SYNCED, updated);
    return { estimate: { ...updated, items }, itemCount: result.items?.length ?? items.length };
  }

  // ------------------------------------------------------------- documents

  async pdf(id: string, download: boolean, caller: Caller): Promise<{ url: string }> {
    const source = await this.renderSource(id, caller);
    return this.requireDocuments().pdf(source, { download, filename: `Estimate-${source.doc.number}.pdf` });
  }

  async html(id: string, caller: Caller): Promise<{ html: string }> {
    return this.requireDocuments().html(await this.renderSource(id, caller));
  }

  /** Portal on-screen view: the caller already proved ownership through the token. */
  async portalHtml(id: string): Promise<{ html: string }> {
    const found = await this.repo.get(id);
    if (!found) throw new NotFoundException('Estimate not found');
    const view = await this.viewFor(found.estimate);
    const doc = { ...found.estimate, items: found.items };
    return this.requireDocuments().html({ kind: 'estimate', doc, view });
  }

  async portalPdf(id: string, download = false): Promise<{ url: string }> {
    const found = await this.repo.get(id);
    if (!found) throw new NotFoundException('Estimate not found');
    const view = await this.viewFor(found.estimate);
    const doc = { ...found.estimate, items: found.items };
    return this.requireDocuments().pdf(
      { kind: 'estimate', doc, view },
      { download, filename: `Estimate-${doc.number}.pdf` },
    );
  }

  /** The document + its job (none for a client estimate) a template renders against. */
  async renderSource(id: string, caller: Caller) {
    const { estimate, items, view } = await this.load(id, caller, true);
    return { kind: 'estimate' as const, doc: { ...estimate, items }, view };
  }

  // ------------------------------------------------------ job lifecycle

  /** Job canceled: every estimate that isn't won (or already archived) is archived. */
  async archiveOpenForDeal(dealId: string): Promise<number> {
    const estimates = await this.repo.listByDeal(dealId);
    let n = 0;
    const now = new Date().toISOString();
    for (const e of estimates) {
      if (e.status === 'won' || e.status === 'archived') continue;
      try {
        const updated = await this.repo.update(e.id, { ...statusChanges(e, 'archived', now), updatedAt: now });
        this.events?.estimate(BillingEventType.ESTIMATE_UPDATED, updated);
        n++;
      } catch (err) {
        this.logger.warn(`archiving estimate ${e.id} failed: ${(err as Error).message}`);
      }
    }
    return n;
  }

  /**
   * Job moved to another client (deal.updated): its estimates follow, as the
   * invoice does, so the old client's portal stops listing them. Reads the job
   * only when it has estimates. Returns how many moved.
   */
  async followDealContact(dealId: string): Promise<number> {
    const estimates = await this.repo.listByDeal(dealId);
    if (!estimates.length) return 0;
    const view = await this.deal.getBillingView(dealId);
    const contactId = view?.deal.contactId;
    if (!contactId) return 0;
    let n = 0;
    for (const e of estimates) {
      if (e.contactId === contactId) continue;
      const updated = await this.repo.update(e.id, {
        contactId,
        createdAt: e.createdAt,
        updatedAt: new Date().toISOString(),
      });
      this.events?.estimate(BillingEventType.ESTIMATE_UPDATED, updated);
      n++;
    }
    return n;
  }

  /** Job deleted: its estimates (and the number counter) go with it. */
  async deleteForDeal(dealId: string): Promise<void> {
    const estimates = await this.repo.listByDeal(dealId);
    for (const e of estimates) {
      await this.repo.delete(e.id);
      this.events?.estimate(BillingEventType.ESTIMATE_DELETED, e);
    }
    await this.repo.deleteCounter(dealId);
  }

  // -------------------------------------------------------------- helpers

  private async load(
    id: string,
    caller: Caller,
    withView = false,
  ): Promise<{ estimate: Estimate; items: EstimateItem[]; view?: DealBillingView }> {
    const found = await this.repo.get(id);
    if (!found) throw new NotFoundException('Estimate not found');
    const scoped = isAssignedOnly(caller, 'estimates');
    // A technician sees the estimates of jobs assigned to them; a client
    // estimate has no job, so it is the office's alone.
    if (scoped && !found.estimate.dealId) {
      throw new ForbiddenException('This estimate belongs to the client and has no job you are assigned to');
    }
    let view: DealBillingView | undefined;
    if (withView || scoped) {
      view = await this.viewFor(found.estimate);
      if (view) assertDealAccess(caller, 'estimates', view.deal);
    }
    return { ...found, view };
  }

  /** The job's billing view, or nothing for a client estimate. */
  private async viewFor(estimate: Pick<Estimate, 'dealId'>): Promise<DealBillingView | undefined> {
    return estimate.dealId ? this.loadView(estimate.dealId) : undefined;
  }

  /** The job timeline, when there is a job. */
  private async timeline(
    dealId: string | undefined,
    type: TimelineEventType,
    caller: Caller,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (!dealId) return;
    await this.deal.addTimeline(dealId, type, caller.user.id, metadata, caller.user.email);
  }

  /** Re-reads the lines after a line write so concurrent edits are counted. */
  private async recompute(estimate: Estimate): Promise<EstimateWithItems> {
    const fresh = await this.repo.get(estimate.id);
    const items = fresh?.items ?? [];
    const base = fresh?.estimate ?? estimate;
    const totals = estimateTotals(base, items);
    // A line changed: Workiz's own Amount (`workizTotal`) no longer describes
    // the estimate, so the reports fall back to BitCRM's total from here on.
    const updated = await this.repo.update(
      estimate.id,
      { totals, updatedAt: new Date().toISOString() },
      base.workizTotal !== undefined ? ['workizTotal'] : [],
    );
    this.events?.estimate(BillingEventType.ESTIMATE_UPDATED, updated);
    return { ...updated, items };
  }

  private toItem(
    estimateId: string,
    lineId: string,
    position: number,
    input: EstimateItemInput,
    createdAt: string,
    updatedAt: string,
  ): EstimateItem {
    return {
      lineId,
      estimateId,
      position,
      productId: input.productId,
      ...(input.productType && { productType: input.productType }),
      name: input.name,
      sku: input.sku,
      ...(input.description?.trim() && { description: input.description.trim() }),
      quantity: input.quantity,
      priceClient: input.priceClient,
      costCompany: input.costCompany,
      costForTech: input.costForTech,
      taxable: input.taxable !== false,
      createdAt,
      updatedAt,
    };
  }

  private fromJobLine(estimateId: string, p: DealProduct, position: number, now: string): EstimateItem {
    return {
      lineId: randomUUID(),
      estimateId,
      position,
      productId: p.productId,
      productType: p.fulfillment === 'service' ? ProductType.SERVICE : ProductType.PRODUCT,
      name: p.name,
      sku: p.sku,
      ...(p.description && { description: p.description }),
      quantity: p.quantity,
      priceClient: p.priceClient,
      costCompany: p.costCompany,
      costForTech: p.costForTech,
      taxable: p.taxable !== false,
      createdAt: now,
      updatedAt: now,
    };
  }

  private async write(id: string, set: Partial<Estimate>, remove: string[], expectedVersion: number) {
    try {
      return await this.repo.update(id, set, remove, expectedVersion);
    } catch (err) {
      if (err instanceof EstimateVersionConflictError) {
        throw new ConflictException('The estimate changed meanwhile — reload and try again');
      }
      throw err;
    }
  }

  private async loadView(dealId: string): Promise<DealBillingView> {
    const view = await this.deal.getBillingView(dealId);
    if (!view) throw new NotFoundException('Job not found');
    return view;
  }

  private async timezoneFor(serviceAreaId?: string): Promise<string> {
    if (!serviceAreaId) return resolveTimezone(undefined);
    const areas = await this.deal.listServiceAreas().catch(() => []);
    return resolveTimezone(areas.find((a) => a.id === serviceAreaId)?.timezone);
  }

  private requireDocuments(): DocumentsService {
    if (!this.documents) throw new Error('DocumentsService not wired');
    return this.documents;
  }

  private requireCrm(): CrmClient {
    if (!this.crm) throw new Error('CrmClient not wired');
    return this.crm;
  }
}

/** Under `assigned_only`: the estimate's job is one of mine. No job ⇒ never mine. */
const onMyJobs = (e: Pick<Estimate, 'dealId'>, mine: Set<string>): boolean => !!e.dealId && mine.has(e.dealId);
