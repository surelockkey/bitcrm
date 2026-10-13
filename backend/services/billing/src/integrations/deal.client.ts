import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { BusinessMetricsService } from '@bitcrm/shared';
import type {
  ClientConfirmJob,
  ClientConfirmRequest,
  Deal,
  DealProduct,
  DocumentDiscount,
  DocumentTotals,
  ProductType,
  TaxRate,
  TimelineEventType,
} from '@bitcrm/types';
import { DEAL_SERVICE_URL } from '../common/constants/services.constants';
import { INTERNAL_FETCH, InternalHttp, defaultFetch, type FetchLike } from './internal-http';

/** `GET /api/deals/internal/:id/billing-view` (contract §1). */
export interface DealBillingView {
  deal: Deal;
  /** The job's company (mirrors `deal.businessProfileId/Name`). */
  businessProfileId?: string;
  businessProfileName?: string;
  items: DealProduct[];
  totals: DocumentTotals;
  jobTypeName?: string;
  technicianNames?: string[];
}

export interface ReplaceAllItem {
  productId: string;
  productType?: ProductType;
  name: string;
  sku: string;
  description?: string;
  quantity: number;
  priceClient: number;
  costCompany: number;
  costForTech: number;
  taxable: boolean;
}

export interface ReplaceAllRequest {
  actorId: string;
  /** Shown on the job timeline; deal-service defaults it to "Billing". */
  actorName?: string;
  estimateNumber: string;
  items: ReplaceAllItem[];
  /** Workiz "This job already has items": absent = replace; `append` adds beside the job's own lines. */
  mode?: 'append';
  taxRateId?: string | null;
  /** The estimate's snapshot — used by deal-service only when `taxRateId` no longer resolves. */
  taxRateName?: string;
  taxRatePercent?: number;
  discount?: DocumentDiscount | null;
}

/** `GET /api/deals/internal/by-contact/:contactId` row. */
export interface ContactDealSummary {
  id: string;
  dealNumber: string;
  superStatus: Deal['superStatus'];
  businessProfileId?: string;
  businessProfileName?: string;
  /* ---- the client portal's My Booking tab */
  /** YYYY-MM-DD on the job's clock. */
  scheduledDate?: string;
  scheduledEndDate?: string;
  /** "HH:MM-HH:MM" on the job's clock; absent on an all-day job. */
  scheduledTimeSlot?: string;
  allDay?: boolean;
  jobTimezone?: string;
  /** The job's area — its zone is the job's when the job carries none. */
  serviceAreaId?: string;
  jobTypeName?: string;
  address?: Deal['address'];
  technicianNames?: string[];
}

/** Body of `PUT /api/deals/internal/:id/payment-status`. */
export interface DealPaymentStatusUpdate {
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  /** Dollars collected so far (the ledger's counted sum, less refunds). */
  amountPaid: number;
  /** The invoice total, so the job's `actualTotal` stays the billed amount. */
  invoiceTotal?: number;
  paidAt?: string;
  paymentId?: string;
}

export interface ServiceAreaSummary {
  id: string;
  name: string;
  timezone?: string;
}

export interface CustomFieldDefinition {
  id: string;
  name: string;
  type?: string;
  active?: boolean;
}

/** A row of the public `GET /api/deals?needsInvoice=true` list. */
export type NeedsInvoiceDeal = Pick<
  Deal,
  'id' | 'dealNumber' | 'contactId' | 'itemCount' | 'createdAt' | 'clientName'
> & { estimatedTotal?: number; actualTotal?: number };

const CATALOG_TTL_MS = 60_000;

/**
 * Deal-service calls (contract §1). Paths used:
 *   GET   /api/deals/internal/:id/billing-view
 *   PUT   /api/deals/internal/:id/products/replace-all
 *   PUT   /api/deals/internal/:id/payment-status      (denormalised job-board flag)
 *   PATCH /api/deals/internal/:id/invoice-link
 *   POST  /api/deals/internal/:id/timeline
 *   GET   /api/deals/internal/tax-rates                (derived from service areas)
 *   GET   /api/deals/internal/by-contact/:contactId    (portal: each job's company)
 *   GET   /api/deals/internal/:id/client-confirm       (the client's confirm page, B12)
 *   POST  /api/deals/internal/:id/client-confirm       (the client tapped Confirm)
 *   GET   /api/deals/internal/by-tech/:techId        (existing — assigned_only scope)
 *   GET   /api/deals/service-areas/internal          (existing — name + timezone)
 *   GET   /api/deals/custom-fields/internal          (existing — id → name)
 *   GET   /api/deals/job-types/internal              (existing — id → name; the Payments report)
 *   POST  /api/deals/by-ids                          (public; the caller's bearer — the Payments report)
 *   GET   /api/deals/internal/needs-invoice/count    (C1 — the summaries' "needs invoice" count)
 *   GET   /api/deals/internal/needs-invoice          (C1 — the needing-invoice list, one page)
 *   GET   /api/deals?needsInvoice=true               (public; the caller's bearer is forwarded —
 *                                                     a technician's scope, and the fallback
 *                                                     while deal-service lacks the C1 routes)
 */
@Injectable()
export class DealClient {
  private readonly logger = new Logger(DealClient.name);
  private readonly http: InternalHttp;
  private readonly catalogs = new Map<string, { rows: unknown[]; expiresAt: number }>();
  /** The catalog reads in flight, so concurrent misses share one request. */
  private readonly catalogFlights = new Map<string, Promise<unknown[]>>();

  constructor(
    @Optional() @Inject(INTERNAL_FETCH) fetchImpl?: FetchLike,
    @Optional() metrics?: BusinessMetricsService,
  ) {
    this.http = new InternalHttp('deal', DEAL_SERVICE_URL, fetchImpl ?? defaultFetch, metrics);
  }

  getBillingView(dealId: string): Promise<DealBillingView | null> {
    return this.http.request<DealBillingView>(
      `/api/deals/internal/${encodeURIComponent(dealId)}/billing-view`,
      { operation: 'getBillingView', nullOn404: true },
    );
  }

  async replaceAllProducts(
    dealId: string,
    body: ReplaceAllRequest,
  ): Promise<{ items: DealProduct[]; deal: Deal }> {
    const res = await this.http.request<{ items: DealProduct[]; deal: Deal }>(
      `/api/deals/internal/${encodeURIComponent(dealId)}/products/replace-all`,
      { method: 'PUT', body, operation: 'replaceAllProducts', timeoutMs: 30_000 },
    );
    return res ?? { items: [], deal: undefined as unknown as Deal };
  }

  /**
   * The job board's denormalised payment flag. Billing owns the ledger; deal
   * keeps only `paymentStatus` + `amountPaid` (and `actualTotal` = the invoice
   * total, never the payment amount).
   */
  async setPaymentStatus(dealId: string, body: DealPaymentStatusUpdate): Promise<void> {
    await this.http.request(`/api/deals/internal/${encodeURIComponent(dealId)}/payment-status`, {
      method: 'PUT',
      body,
      operation: 'setPaymentStatus',
      timeoutMs: 5_000,
    });
  }

  async setInvoiceLink(dealId: string, invoiceId: string | null): Promise<void> {
    await this.http.request(`/api/deals/internal/${encodeURIComponent(dealId)}/invoice-link`, {
      method: 'PATCH',
      body: { invoiceId },
      operation: 'setInvoiceLink',
      nullOn404: invoiceId === null,
    });
  }

  /** Best effort: the job history must never fail a billing write. */
  async addTimeline(
    dealId: string,
    type: TimelineEventType,
    actorId: string,
    metadata?: Record<string, unknown>,
    actorName?: string,
  ): Promise<void> {
    try {
      await this.http.request(`/api/deals/internal/${encodeURIComponent(dealId)}/timeline`, {
        method: 'POST',
        body: { type, actorId, ...(actorName && { actorName }), metadata },
        operation: 'addTimeline',
        timeoutMs: 5_000,
      });
    } catch (err) {
      this.logger.warn(`timeline ${type} on ${dealId} failed: ${(err as Error).message}`);
    }
  }

  async listTaxRates(): Promise<TaxRate[]> {
    return (
      (await this.http.request<TaxRate[]>('/api/deals/internal/tax-rates', { operation: 'listTaxRates' })) ?? []
    );
  }

  /** The job as the client's confirm page shows it (B12); null when deal-service has no such job. */
  getClientConfirm(dealId: string): Promise<ClientConfirmJob | null> {
    return this.http.request<ClientConfirmJob>(`/api/deals/internal/${encodeURIComponent(dealId)}/client-confirm`, {
      operation: 'getClientConfirm',
      nullOn404: true,
      timeoutMs: 5_000,
    });
  }

  /** The client tapped Confirm: deal-service decides, records once, logs and publishes. */
  confirmByClient(dealId: string, body: ClientConfirmRequest): Promise<ClientConfirmJob | null> {
    return this.http.request<ClientConfirmJob>(`/api/deals/internal/${encodeURIComponent(dealId)}/client-confirm`, {
      method: 'POST',
      body,
      operation: 'confirmByClient',
      nullOn404: true,
      timeoutMs: 5_000,
    });
  }

  /** A contact's jobs, light (id, number, company). */
  async listByContact(contactId: string): Promise<ContactDealSummary[]> {
    return (
      (await this.http.request<ContactDealSummary[]>(
        `/api/deals/internal/by-contact/${encodeURIComponent(contactId)}`,
        { operation: 'listByContact' },
      )) ?? []
    );
  }

  /** Deal ids assigned to a technician (existing route, capped at 100 by deal-service). */
  async listDealIdsByTech(techId: string): Promise<Set<string>> {
    const rows =
      (await this.http.request<Array<{ id: string }>>(
        `/api/deals/internal/by-tech/${encodeURIComponent(techId)}`,
        { operation: 'listByTech' },
      )) ?? [];
    return new Set(rows.map((r) => r.id));
  }

  /**
   * The jobs of a set of ids (at most 100), through the PUBLIC `POST /deals/by-ids`
   * on the caller's own bearer — there is no internal twin, and this way the
   * caller's `deals` scope applies. No bearer, no answer.
   */
  async getDealsByIds(ids: string[], authorization: string | undefined): Promise<Deal[]> {
    if (!authorization || ids.length === 0) return [];
    return (
      (await this.http.request<Deal[]>('/api/deals/by-ids', {
        method: 'POST',
        body: { ids: ids.slice(0, 100) },
        operation: 'getDealsByIds',
        headers: { authorization },
      })) ?? []
    );
  }

  /** id → name of every job type (active or not), cached 60s. */
  async listJobTypes(): Promise<Array<{ id: string; name: string }>> {
    return this.cachedCatalog<{ id: string; name: string }>('job-types', '/api/deals/job-types/internal');
  }

  async listServiceAreas(): Promise<ServiceAreaSummary[]> {
    return this.cachedCatalog<ServiceAreaSummary>('service-areas', '/api/deals/service-areas/internal');
  }

  async listCustomFields(): Promise<CustomFieldDefinition[]> {
    return this.cachedCatalog<CustomFieldDefinition>('custom-fields', '/api/deals/custom-fields/internal');
  }

  /**
   * Jobs with items and no invoice. There is no internal variant in the
   * contract, so the caller's own bearer is forwarded to the public list —
   * which also applies the caller's `deals` data scope.
   */
  async listNeedsInvoice(authorization: string | undefined, limit = 100): Promise<NeedsInvoiceDeal[]> {
    if (!authorization) return [];
    return (
      (await this.http.request<NeedsInvoiceDeal[]>(`/api/deals?needsInvoice=true&limit=${limit}`, {
        operation: 'listNeedsInvoice',
        headers: { authorization },
      })) ?? []
    );
  }

  /**
   * How many jobs have items and no invoice — account-wide, no data scope
   * (contract C1). `null` when deal-service answers 404: a deal-service from
   * before the route, and the caller falls back to `listNeedsInvoice`.
   */
  async countNeedsInvoice(): Promise<number | null> {
    const res = await this.http.request<{ count: number }>('/api/deals/internal/needs-invoice/count', {
      operation: 'countNeedsInvoice',
      nullOn404: true,
      timeoutMs: 5_000,
    });
    return res ? Number(res.count) || 0 : null;
  }

  /**
   * One page of the jobs with items and no invoice — account-wide (contract
   * C1), same row shape as the public list. `null` on 404, as above.
   */
  listNeedsInvoiceInternal(limit = 100, cursor?: string): Promise<NeedsInvoiceDeal[] | null> {
    const qs = `limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    return this.http.request<NeedsInvoiceDeal[]>(`/api/deals/internal/needs-invoice?${qs}`, {
      operation: 'listNeedsInvoiceInternal',
      nullOn404: true,
    });
  }

  /**
   * A deal-service catalog, cached `CATALOG_TTL_MS`. Single-flight: misses
   * that arrive while a read is in flight wait for it instead of each asking
   * deal-service. A failure is never cached — the waiters of that flight get
   * the stale rows (or `[]`), and the next caller tries again.
   */
  private async cachedCatalog<T>(key: string, path: string): Promise<T[]> {
    const hit = this.catalogs.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.rows as T[];
    const pending = this.catalogFlights.get(key);
    if (pending) return pending as Promise<T[]>;
    const flight = (async () => {
      try {
        const rows = (await this.http.request<T[]>(path, { operation: `catalog:${key}` })) ?? [];
        this.catalogs.set(key, { rows, expiresAt: Date.now() + CATALOG_TTL_MS });
        return rows;
      } catch (err) {
        this.logger.warn(`catalog ${key} unavailable: ${(err as Error).message}`);
        return (this.catalogs.get(key)?.rows as T[]) ?? [];
      } finally {
        this.catalogFlights.delete(key);
      }
    })();
    this.catalogFlights.set(key, flight);
    return flight;
  }
}
