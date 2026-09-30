import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SnsPublisherService, BusinessMetricsService } from '@bitcrm/shared';
import {
  ProductType,
  TimelineEventType,
  calculateDocumentTotals,
  type Deal,
  type DealProduct,
  type DealProductFulfillment,
  type DocumentDiscount,
  type DocumentTotals,
  type JwtUser,
} from '@bitcrm/types';
import { DealsRepository, type DealUpdate } from '../deals.repository';
import { DealsCacheService } from '../deals-cache.service';
import { DealsService } from '../deals.service';
import { DealProductsRepository, type DealProductDraft } from '../../products/deal-products.repository';
import { TimelineRepository } from '../../timeline/timeline.repository';
import { InternalHttpService } from '../../common/services/internal-http.service';
import { TaxRatesService } from '../../tax-rates/tax-rates.service';
import { JobTypesService } from '../../job-types/job-types.service';
import { TechnicianEligibilityRepository } from '../../technician-eligibility/technician-eligibility.repository';
import { DealTaxResolver, type DealTaxSnapshot } from './deal-tax.resolver';
import { type ReplaceAllDealProductsDto } from './dto/replace-all-deal-products.dto';
import { type InternalTimelineDto } from './dto/internal-timeline.dto';

export interface DealBillingView {
  deal: Deal;
  /** The job's company (also on `deal`), surfaced for document building. */
  businessProfileId?: string;
  businessProfileName?: string;
  items: DealProduct[];
  totals: DocumentTotals;
  jobTypeName?: string;
  technicianNames?: string[];
}

/** `GET internal/by-contact/:contactId` row. */
export interface ContactDealSummary {
  id: string;
  dealNumber: string;
  superStatus: Deal['superStatus'];
  businessProfileId?: string;
  businessProfileName?: string;
}

/** Who a timeline entry / stock move is attributed to. */
interface Actor {
  id: string;
  name: string;
}

type StockItems = Array<{ productId: string; productName: string; quantity: number }>;

/** One applied inventory movement, kept so a failed sync can be undone. */
interface StockMove {
  kind: 'deduct' | 'restore';
  containerId: string;
  items: StockItems;
}

/**
 * The job side of billing: the job's single tax rate and discount, per-line
 * taxable flags, the totals every document shows, and the internal endpoints
 * the billing service builds invoices/estimates from. All money math goes
 * through `calculateDocumentTotals` so the API, web and PDFs agree.
 */
@Injectable()
export class DealBillingService {
  private readonly logger = new Logger(DealBillingService.name);

  constructor(
    private readonly repository: DealsRepository,
    private readonly cache: DealsCacheService,
    private readonly productsRepo: DealProductsRepository,
    private readonly timelineRepo: TimelineRepository,
    private readonly internalHttp: InternalHttpService,
    private readonly taxRates: TaxRatesService,
    private readonly taxResolver: DealTaxResolver,
    private readonly jobTypes: JobTypesService,
    private readonly eligibility: TechnicianEligibilityRepository,
    private readonly deals: DealsService,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {}

  static totalsFor(deal: Deal, items: DealProduct[]): DocumentTotals {
    return calculateDocumentTotals({
      lines: items,
      taxRatePercent: deal.taxRatePercent ?? 0,
      discount: deal.discount,
      // The legacy payment hook records a single full payment on the job.
      amountPaid: deal.paymentStatus === 'paid' ? deal.actualTotal ?? 0 : 0,
    });
  }

  async getTotals(id: string): Promise<DocumentTotals> {
    const deal = await this.deals.findById(id);
    return DealBillingService.totalsFor(deal, await this.productsRepo.findByDeal(id));
  }

  /**
   * Pick the job's tax by hand (`taxSource: 'manual'`, so later market/client
   * changes stop overriding it). `null` means "no tax on this job".
   */
  async setTax(id: string, taxRateId: string | null | undefined, caller: JwtUser): Promise<Deal> {
    if (taxRateId === undefined) {
      throw new BadRequestException('taxRateId is required (use null for no tax)');
    }
    const existing = await this.deals.findById(id);
    let to: DealTaxSnapshot = {
      taxSource: 'manual', taxRateId: null, taxRateName: null, taxRatePercent: null,
    };
    if (taxRateId !== null) {
      const rate = await this.findRate(taxRateId);
      if (!rate.active) throw new BadRequestException(`Tax rate "${rate.name}" is inactive`);
      to = this.taxResolver.snapshotOf(rate, 'manual');
    }
    return this.writeTax(existing, to, this.actorOf(caller), 'manual');
  }

  /** Drop any manual choice and re-resolve: exempt → service area tax → none. */
  async autoTax(id: string, caller: JwtUser): Promise<Deal> {
    const existing = await this.deals.findById(id);
    const to = await this.taxResolver.resolve({
      contactId: existing.contactId,
      companyId: existing.companyId,
      serviceAreaId: existing.serviceAreaId,
    });
    return this.writeTax(existing, to, this.actorOf(caller), 'auto');
  }

  async setDiscount(
    id: string,
    discount: DocumentDiscount | null | undefined,
    caller: JwtUser,
  ): Promise<Deal> {
    if (discount === undefined) {
      throw new BadRequestException('discount is required (use null to remove it)');
    }
    const next = discount === null ? null : this.validateDiscount(discount);
    const existing = await this.deals.findById(id);
    const from = existing.discount ?? null;

    const deal = await this.repository.update(id, { discount: next });
    await this.deals.refreshTotals(id);
    await this.cache.invalidate(id);
    await this.addEntry(id, TimelineEventType.DISCOUNT_CHANGED, this.actorOf(caller), { from, to: next });
    this.publishEvent('deal.updated', { dealId: id, updatedBy: caller.id });
    return deal;
  }

  async setProductTaxable(
    id: string,
    productId: string,
    taxable: boolean,
    caller: JwtUser,
  ): Promise<DealProduct> {
    if (typeof taxable !== 'boolean') throw new BadRequestException('taxable must be a boolean');
    const existing = await this.productsRepo.findProduct(id, productId);
    if (!existing) throw new NotFoundException(`Product ${productId} not found on deal ${id}`);

    const line = await this.productsRepo.setTaxable(id, productId, taxable);
    await this.deals.refreshTotals(id);
    await this.cache.invalidate(id);
    if ((existing.taxable ?? true) !== taxable) {
      await this.addEntry(id, TimelineEventType.TAX_CHANGED, this.actorOf(caller), {
        productId,
        productName: existing.name,
        from: { taxable: existing.taxable ?? true },
        to: { taxable },
      });
    }
    this.publishEvent('deal.product_updated', { dealId: id, productId, taxable });
    return line;
  }

  async getBillingView(id: string): Promise<DealBillingView> {
    const deal = await this.deals.findById(id);
    const items = await this.productsRepo.findByDeal(id);

    const jobTypeName = await this.jobTypes
      .findById(deal.jobTypeId)
      .then((t) => t.name)
      .catch(() => undefined);

    // Names come from the local eligibility projection — no user-service hop.
    const technicianNames: string[] = [];
    for (const techId of deal.assignedTechIds) {
      const tech = await this.eligibility.get(techId).catch(() => null);
      const name = [tech?.firstName, tech?.lastName].filter(Boolean).join(' ').trim();
      if (name) technicianNames.push(name);
    }

    return {
      deal,
      ...(deal.businessProfileId && { businessProfileId: deal.businessProfileId }),
      ...(deal.businessProfileName && { businessProfileName: deal.businessProfileName }),
      items,
      totals: DealBillingService.totalsFor(deal, items),
      jobTypeName,
      technicianNames,
    };
  }

  /**
   * Estimate → job sync: the estimate's lines overwrite the job's.
   *
   * 1. every existing `sourced` line goes back to its technician's container;
   * 2. incoming lines are merged by productId (quantities summed);
   * 3. services become `service` lines; stock products are `sourced` from the
   *    first assigned technician whose container covers the quantity, else
   *    `to_order`;
   * 4. rows are rewritten, `itemCount` and the optional tax/discount applied.
   *
   * Any failure after stock has moved undoes the moves in reverse, so a
   * half-finished sync never leaves vans short.
   */
  async replaceAllProducts(
    id: string,
    dto: ReplaceAllDealProductsDto,
  ): Promise<{ items: DealProduct[]; deal: Deal }> {
    const deal = await this.deals.findById(id);
    const actor: Actor = { id: dto.actorId, name: dto.actorName || 'Estimate sync' };
    const existing = await this.productsRepo.findByDeal(id);
    const existingById = new Map(existing.map((p) => [p.productId, p]));

    const merged = this.mergeLines(dto.items ?? []);
    // Resolve product types (and the tax snapshot) before any stock moves.
    const types = new Map<string, boolean>();
    for (const line of merged) {
      types.set(line.productId, await this.isServiceLine(line));
    }
    const taxUpdate = await this.syncTaxUpdate(deal, dto);
    const discountUpdate =
      dto.discount === undefined
        ? {}
        : { discount: dto.discount === null ? null : this.validateDiscount(dto.discount) };

    const stockMeta = { dealId: id, performedBy: actor.id, performedByName: actor.name };
    const applied: StockMove[] = [];
    const now = new Date().toISOString();
    const rows: DealProductDraft[] = [];
    let writing = false;

    try {
      for (const line of existing) {
        if ((line.fulfillment ?? 'sourced') !== 'sourced') continue;
        const containerId =
          line.sourceTechId ??
          (deal.assignedTechIds.length === 1 ? deal.assignedTechIds[0] : undefined);
        if (!containerId) continue;
        const items = [{ productId: line.productId, productName: line.name, quantity: line.quantity }];
        await this.internalHttp.restoreStock({ containerId, items, ...stockMeta });
        applied.push({ kind: 'restore', containerId, items });
      }

      for (const line of merged) {
        let fulfillment: DealProductFulfillment = 'to_order';
        let sourceTechId: string | undefined;
        if (types.get(line.productId)) {
          fulfillment = 'service';
        } else {
          const items = [{ productId: line.productId, productName: line.name, quantity: line.quantity }];
          sourceTechId = await this.deductFromFirstTech(deal.assignedTechIds, items, stockMeta, applied);
          if (sourceTechId) fulfillment = 'sourced';
        }

        const previous = existingById.get(line.productId);
        rows.push({
          // A synced line that names the same product stays the same line,
          // so nothing pointing at it is orphaned by a re-sync.
          ...(previous && { lineId: previous.lineId }),
          productId: line.productId,
          name: line.name,
          sku: line.sku,
          quantity: line.quantity,
          costCompany: line.costCompany,
          costForTech: line.costForTech,
          priceClient: line.priceClient,
          fulfillment,
          ...(sourceTechId && { sourceTechId }),
          ...(fulfillment === 'to_order' &&
            previous?.fulfillment === 'to_order' &&
            previous.orderedAt && { orderedAt: previous.orderedAt }),
          taxable: line.taxable ?? true,
          ...(line.description && { description: line.description }),
          addedBy: previous?.addedBy ?? actor.id,
          addedAt: previous?.addedAt ?? now,
          updatedBy: actor.id,
          updatedAt: now,
        });
      }

      writing = true;
      const keep = new Set(rows.map((r) => r.lineId).filter(Boolean));
      for (const line of existing) {
        if (!keep.has(line.lineId)) await this.productsRepo.removeProduct(id, line.lineId);
      }
      for (const row of rows) await this.productsRepo.addProduct(id, row);
    } catch (error) {
      if (writing) await this.restoreRows(id, existing, rows);
      await this.rollback(applied, stockMeta);
      throw error;
    }

    const updated = await this.repository.update(id, {
      itemCount: rows.length,
      ...taxUpdate,
      ...discountUpdate,
    });
    await this.deals.refreshTotals(id);
    await this.cache.invalidate(id);

    await this.addEntry(id, TimelineEventType.ESTIMATE_SYNCED, actor, {
      estimateNumber: dto.estimateNumber,
      itemCount: rows.length,
    });
    this.businessMetrics?.entityUpdated?.inc({ entity_type: 'deal' });
    this.publishEvent('deal.updated', { dealId: id, updatedBy: actor.id });
    this.publishEvent('deal.products_replaced', {
      dealId: id,
      itemCount: rows.length,
      estimateNumber: dto.estimateNumber,
      replacedBy: actor.id,
    });

    return { items: await this.productsRepo.findByDeal(id), deal: updated };
  }

  /** Billing marks the job invoiced (invoiceId === dealId) or un-invoiced (null). */
  async setInvoiceLink(id: string, invoiceId: string | null | undefined): Promise<void> {
    if (invoiceId === undefined) {
      throw new BadRequestException('invoiceId is required (use null to unlink)');
    }
    await this.deals.findById(id);
    await this.repository.update(id, { invoiceId });
    await this.cache.invalidate(id);
    this.publishEvent('deal.updated', { dealId: id });
  }

  /** A timeline entry written on behalf of another service (billing documents). */
  async addTimeline(id: string, dto: InternalTimelineDto): Promise<void> {
    await this.deals.findById(id);
    await this.addEntry(
      id,
      dto.type,
      { id: dto.actorId, name: dto.actorName || 'Billing' },
      dto.metadata ?? {},
    );
  }

  /** Every deal of a contact, light (portal branding / contact tabs). */
  async listByContact(contactId: string): Promise<ContactDealSummary[]> {
    const out: ContactDealSummary[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.repository.findByContact(contactId, 100, cursor);
      for (const d of page.items) {
        out.push({
          id: d.id,
          dealNumber: d.dealNumber,
          superStatus: d.superStatus,
          ...(d.businessProfileId && { businessProfileId: d.businessProfileId }),
          ...(d.businessProfileName && { businessProfileName: d.businessProfileName }),
        });
      }
      cursor = page.nextCursor;
    } while (cursor && out.length < 1000);
    return out;
  }

  // ------------------------------------------------------------------ helpers

  private async writeTax(
    existing: Deal,
    to: DealTaxSnapshot,
    actor: Actor,
    reason: 'manual' | 'auto',
  ): Promise<Deal> {
    const from = DealTaxResolver.fromDeal(existing);
    if (DealTaxResolver.sameTax(from, to)) return existing;

    const deal = await this.repository.update(existing.id, { ...to });
    await this.deals.refreshTotals(existing.id);
    await this.cache.invalidate(existing.id);
    await this.addEntry(existing.id, TimelineEventType.TAX_CHANGED, actor, { from, to, reason });
    this.publishEvent('deal.updated', { dealId: existing.id, updatedBy: actor.id });
    return deal;
  }

  /** A selectable rate (= a service area with a tax); unknown → 400. */
  private async findRate(taxRateId: string) {
    const rate = await this.taxRates.findOptional(taxRateId);
    if (!rate) throw new BadRequestException(`Tax rate ${taxRateId} not found`);
    return rate;
  }

  /**
   * Tax fields for a sync: absent → untouched; null → manual "no tax"; an id →
   * manual snapshot of that area's tax. An archived area is accepted here —
   * the estimate may legitimately predate its archival.
   *
   * An id that no longer resolves (a pre-Revision-2 catalog rate, or a deleted
   * area / removed tax) keeps the job's tax when it is the rate the job already
   * carries, else falls back to the estimate's own name/percent snapshot, else
   * is a 400.
   */
  private async syncTaxUpdate(
    deal: Deal,
    dto: Pick<ReplaceAllDealProductsDto, 'taxRateId' | 'taxRateName' | 'taxRatePercent'>,
  ): Promise<DealUpdate> {
    const { taxRateId } = dto;
    if (taxRateId === undefined) return {};
    if (taxRateId === null) {
      return { taxSource: 'manual', taxRateId: null, taxRateName: null, taxRatePercent: null };
    }
    const rate = await this.taxRates.findOptional(taxRateId);
    if (rate) return { ...this.taxResolver.snapshotOf(rate, 'manual') };
    if (deal.taxRateId === taxRateId) return {};
    if (dto.taxRateName && typeof dto.taxRatePercent === 'number') {
      return {
        taxSource: 'manual',
        taxRateId,
        taxRateName: dto.taxRateName,
        taxRatePercent: dto.taxRatePercent,
      };
    }
    throw new BadRequestException(`Tax rate ${taxRateId} not found`);
  }

  private validateDiscount(discount: DocumentDiscount): DocumentDiscount {
    const { type, value } = discount ?? ({} as DocumentDiscount);
    if (type !== 'amount' && type !== 'percent') {
      throw new BadRequestException("discount.type must be 'amount' or 'percent'");
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new BadRequestException('discount.value must be a non-negative number');
    }
    if (type === 'percent' && value > 100) {
      throw new BadRequestException('A percent discount cannot exceed 100');
    }
    return { type, value };
  }

  private mergeLines(items: ReplaceAllDealProductsDto['items']): ReplaceAllDealProductsDto['items'] {
    const byId = new Map<string, ReplaceAllDealProductsDto['items'][number]>();
    for (const item of items) {
      const prev = byId.get(item.productId);
      if (prev) prev.quantity += item.quantity;
      else byId.set(item.productId, { ...item });
    }
    return [...byId.values()];
  }

  private async isServiceLine(line: { productId: string; productType?: string; name: string }): Promise<boolean> {
    if (line.productType) return line.productType === ProductType.SERVICE;
    const product = await this.internalHttp.getProduct(line.productId);
    if (!product) {
      throw new BadRequestException(`Product "${line.name}" was not found in inventory`);
    }
    return product.type === ProductType.SERVICE;
  }

  /**
   * Deduct from the first assigned technician that has enough. A 4xx is
   * inventory's "not enough here" — try the next one; anything else aborts.
   */
  private async deductFromFirstTech(
    techIds: string[],
    items: StockItems,
    meta: { dealId: string; performedBy: string; performedByName: string },
    applied: StockMove[],
  ): Promise<string | undefined> {
    for (const containerId of techIds) {
      try {
        await this.internalHttp.deductStock({ containerId, items, ...meta });
        applied.push({ kind: 'deduct', containerId, items });
        return containerId;
      } catch (error) {
        if (error instanceof HttpException && error.getStatus() >= 400 && error.getStatus() < 500) {
          continue;
        }
        throw error;
      }
    }
    return undefined;
  }

  private async rollback(
    applied: StockMove[],
    meta: { dealId: string; performedBy: string; performedByName: string },
  ): Promise<void> {
    for (const move of [...applied].reverse()) {
      const dto = { containerId: move.containerId, items: move.items, ...meta };
      try {
        if (move.kind === 'deduct') await this.internalHttp.restoreStock(dto);
        else await this.internalHttp.deductStock(dto);
      } catch (err) {
        this.logger.error(
          `Estimate sync rollback failed for deal ${meta.dealId} (${move.kind} ${move.containerId}): ${(err as Error).message}`,
        );
      }
    }
  }

  /** Best-effort: put the job's original lines back after a failed rewrite. */
  private async restoreRows(id: string, original: DealProduct[], written: DealProductDraft[]): Promise<void> {
    try {
      const originalIds = new Set(original.map((p) => p.lineId));
      for (const row of written) {
        if (row.lineId && !originalIds.has(row.lineId)) await this.productsRepo.removeProduct(id, row.lineId);
      }
      for (const row of original) await this.productsRepo.addProduct(id, row);
    } catch (err) {
      this.logger.error(`Could not restore original lines on deal ${id}: ${(err as Error).message}`);
    }
  }

  private actorOf(caller: JwtUser): Actor {
    return { id: caller.id, name: caller.email };
  }

  private async addEntry(
    dealId: string,
    eventType: TimelineEventType,
    actor: Actor,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.timelineRepo.addEntry({
      id: randomUUID(),
      dealId,
      eventType,
      actorId: actor.id,
      actorName: actor.name,
      timestamp: new Date().toISOString(),
      details,
    });
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
