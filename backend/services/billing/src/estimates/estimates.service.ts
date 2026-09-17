import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
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
} from '@bitcrm/types';
import { assertDealAccess, isAssignedOnly, type Caller } from '../common/access';
import { isYmd, resolveTimezone, todayIn } from '../common/dates';
import { DocumentsService } from '../documents/documents.service';
import { BillingEventsPublisher } from '../integrations/billing-events.publisher';
import { DealClient, type DealBillingView, type ReplaceAllRequest } from '../integrations/deal.client';
import {
  assertSyncable,
  estimateNumber,
  estimateTotals,
  markSentChanges,
  reorderPositions,
  sortItems,
  statusChanges,
} from './estimate-rules';
import {
  EstimateVersionConflictError,
  EstimatesRepository,
  type EstimateListFilter,
} from './estimates.repository';

export interface CreateEstimateInput {
  dealId: string;
  name?: string;
  copyJobItems?: boolean;
}

export interface UpdateEstimateInput {
  name?: string | null;
  estimateDate?: string;
  notes?: string | null;
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
 */
@Injectable()
export class EstimatesService {
  private readonly logger = new Logger(EstimatesService.name);

  constructor(
    private readonly repo: EstimatesRepository,
    private readonly deal: DealClient,
    @Optional() private readonly documents?: DocumentsService,
    @Optional() private readonly events?: BillingEventsPublisher,
  ) {}

  // ---------------------------------------------------------------- create

  async create(input: CreateEstimateInput, caller: Caller): Promise<EstimateWithItems> {
    const view = await this.loadView(input.dealId);
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

  async duplicate(id: string, caller: Caller): Promise<EstimateWithItems> {
    const src = await this.load(id, caller);
    const seq = await this.repo.nextSeq(src.estimate.dealId);
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
      number: estimateNumber(src.estimate.dealNumber, seq),
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
    await this.deal.addTimeline(copy.dealId, TimelineEventType.ESTIMATE_CREATED, caller.user.id, {
      estimateId: newId,
      number: copy.number,
      duplicatedFrom: src.estimate.number,
    }, caller.user.email);
    this.events?.estimate(BillingEventType.ESTIMATE_CREATED, copy);
    return { ...copy, items };
  }

  // ------------------------------------------------------------------ read

  async get(id: string, caller: Caller): Promise<EstimateWithItems> {
    const { estimate, items } = await this.load(id, caller);
    return { ...estimate, items };
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
    // Page-local filter (see InvoicesService.list).
    const mine = await this.deal.listDealIdsByTech(caller.user.id);
    return { ...result, items: result.items.filter((e) => mine.has(e.dealId)) };
  }

  async summary(caller: Caller): Promise<EstimateSummary> {
    let all = await this.repo.listAll();
    if (isAssignedOnly(caller, 'estimates')) {
      const mine = await this.deal.listDealIdsByTech(caller.user.id);
      all = all.filter((e) => mine.has(e.dealId));
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
    const optional = (key: 'name' | 'notes' | 'templateId', value: string | null | undefined) => {
      if (value === undefined) return;
      if (value === null || value.trim() === '') remove.push(key);
      else set[key] = value.trim();
    };
    optional('name', input.name);
    optional('notes', input.notes);
    optional('templateId', input.templateId);
    if (input.estimateDate !== undefined) set.estimateDate = input.estimateDate;

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

    const next = { ...estimate, ...set } as Estimate;
    for (const k of remove) delete (next as unknown as Record<string, unknown>)[k];
    set.totals = estimateTotals(next, items);

    const updated = await this.write(id, set, remove, estimate.version);
    this.events?.estimate(BillingEventType.ESTIMATE_UPDATED, updated);
    return { ...updated, items };
  }

  async setStatus(id: string, status: EstimateStatus, caller: Caller): Promise<EstimateWithItems> {
    const { estimate, items } = await this.load(id, caller);
    const changes = statusChanges(estimate, status, new Date().toISOString());
    if (!Object.keys(changes).length) return { ...estimate, items };
    const updated = await this.write(id, { ...changes, updatedAt: changes.statusChangedAt }, [], estimate.version);
    await this.deal.addTimeline(estimate.dealId, TimelineEventType.ESTIMATE_STATUS_CHANGED, caller.user.id, {
      estimateId: id,
      number: estimate.number,
      from: estimate.status,
      to: status,
    }, caller.user.email);
    this.events?.estimate(BillingEventType.ESTIMATE_UPDATED, updated);
    return { ...updated, items };
  }

  async markSent(id: string, sent: boolean, caller: Caller): Promise<EstimateWithItems> {
    const { estimate, items } = await this.load(id, caller);
    const now = new Date().toISOString();
    const { set, remove } = markSentChanges(estimate, sent, caller.user.id, now);
    const updated = await this.write(id, { ...set, updatedAt: now }, remove, estimate.version);
    if (sent) {
      await this.deal.addTimeline(estimate.dealId, TimelineEventType.ESTIMATE_SENT, caller.user.id, {
        estimateId: id,
        number: estimate.number,
      }, caller.user.email);
    }
    this.events?.estimate(BillingEventType.ESTIMATE_UPDATED, updated);
    return { ...updated, items };
  }

  async delete(id: string, caller: Caller): Promise<void> {
    const { estimate } = await this.load(id, caller);
    await this.repo.delete(id);
    await this.deal.addTimeline(estimate.dealId, TimelineEventType.ESTIMATE_DELETED, caller.user.id, {
      estimateId: id,
      number: estimate.number,
    }, caller.user.email);
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

  async syncToJob(id: string, caller: Caller): Promise<{ estimate: EstimateWithItems; itemCount: number }> {
    const { estimate, items } = await this.load(id, caller);
    assertSyncable(estimate, items.length);

    const body: ReplaceAllRequest = {
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
    const result = await this.deal.replaceAllProducts(estimate.dealId, body);

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

  async portalPdf(id: string, download = false): Promise<{ url: string }> {
    const found = await this.repo.get(id);
    if (!found) throw new NotFoundException('Estimate not found');
    const view = await this.loadView(found.estimate.dealId);
    const doc = { ...found.estimate, items: found.items };
    return this.requireDocuments().pdf(
      { kind: 'estimate', doc, view },
      { download, filename: `Estimate-${doc.number}.pdf` },
    );
  }

  async renderSource(id: string, caller: Caller) {
    const { estimate, items, view } = await this.load(id, caller, true);
    return { kind: 'estimate' as const, doc: { ...estimate, items }, view: view ?? (await this.loadView(estimate.dealId)) };
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
    let view: DealBillingView | undefined;
    if (withView || isAssignedOnly(caller, 'estimates')) {
      view = await this.loadView(found.estimate.dealId);
      assertDealAccess(caller, 'estimates', view.deal);
    }
    return { ...found, view };
  }

  /** Re-reads the lines after a line write so concurrent edits are counted. */
  private async recompute(estimate: Estimate): Promise<EstimateWithItems> {
    const fresh = await this.repo.get(estimate.id);
    const items = fresh?.items ?? [];
    const base = fresh?.estimate ?? estimate;
    const totals = estimateTotals(base, items);
    const updated = await this.repo.update(estimate.id, { totals, updatedAt: new Date().toISOString() });
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
}
