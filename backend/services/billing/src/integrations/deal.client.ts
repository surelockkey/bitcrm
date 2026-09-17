import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { BusinessMetricsService } from '@bitcrm/shared';
import type {
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
 *   PATCH /api/deals/internal/:id/invoice-link
 *   POST  /api/deals/internal/:id/timeline
 *   GET   /api/deals/internal/tax-rates                (derived from service areas)
 *   GET   /api/deals/internal/by-contact/:contactId    (portal: each job's company)
 *   GET   /api/deals/internal/by-tech/:techId        (existing — assigned_only scope)
 *   GET   /api/deals/service-areas/internal          (existing — name + timezone)
 *   GET   /api/deals/custom-fields/internal          (existing — id → name)
 *   GET   /api/deals?needsInvoice=true               (public; the caller's bearer is forwarded)
 */
@Injectable()
export class DealClient {
  private readonly logger = new Logger(DealClient.name);
  private readonly http: InternalHttp;
  private readonly catalogs = new Map<string, { rows: unknown[]; expiresAt: number }>();

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

  private async cachedCatalog<T>(key: string, path: string): Promise<T[]> {
    const hit = this.catalogs.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.rows as T[];
    try {
      const rows = (await this.http.request<T[]>(path, { operation: `catalog:${key}` })) ?? [];
      this.catalogs.set(key, { rows, expiresAt: Date.now() + CATALOG_TTL_MS });
      return rows;
    } catch (err) {
      this.logger.warn(`catalog ${key} unavailable: ${(err as Error).message}`);
      return (hit?.rows as T[]) ?? [];
    }
  }
}
