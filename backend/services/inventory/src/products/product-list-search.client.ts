import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ProductStockLevel } from './products.constants';

/** Which partition the list stands for — the Price Book (GSI4) or the stock-managed one (GSI3). */
export type ProductListPartition = 'catalog' | 'stock';

/** The list filters search answers, same names and meanings as `ProductListFilters`. */
export interface SearchableProductFilters {
  type?: string;
  status?: string;
  search?: string;
  brandId?: string;
  manageStock?: boolean;
  stockLevel?: ProductStockLevel;
}

export interface ProductListSearchOptions {
  baseUrl?: string;
  secret?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

/** Injection token for the options — unset in the app (env defaults apply), passed in tests. */
export const PRODUCT_LIST_SEARCH_OPTIONS = Symbol('PRODUCT_LIST_SEARCH_OPTIONS');

/** "Not ready" is believed this long before search is asked again. */
const NOT_READY_REST_MS = 60_000;
/** After a failure or a timeout, search rests this long. */
const FAILURE_REST_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 1_000;

/**
 * search-service's read model of the Price Book (`POST /internal/products/
 * query`): a filtered `GET /products` or `/products/count` is one OpenSearch
 * query there instead of a walk of the ~16 MB `PRODUCTS#ALL` partition (up to
 * forty 1 MB reads, each parsed and unmarshalled on this task's half vCPU).
 *
 * Optional all the way: `null` is the answer whenever search cannot be
 * trusted to answer exactly — no `SEARCH_SERVICE_URL`, the index not stamped
 * ready by search's product backfill, an error, or no answer within a
 * second — and the caller reads DynamoDB as before. "Not ready" is
 * remembered for a minute and a failure for half a minute, so a missing or
 * broken search costs at most one call per window, not one per request.
 */
@Injectable()
export class ProductListSearchClient {
  private readonly logger = new Logger(ProductListSearchClient.name);
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private restUntil = 0;

  constructor(@Optional() @Inject(PRODUCT_LIST_SEARCH_OPTIONS) options?: ProductListSearchOptions) {
    this.baseUrl = (options?.baseUrl ?? process.env.SEARCH_SERVICE_URL ?? '').replace(/\/+$/, '');
    this.secret = options?.secret ?? process.env.INTERNAL_SERVICE_SECRET ?? '';
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchFn = options?.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.now = options?.now ?? Date.now;
  }

  /** One page: product ids in partition order and, when more follow, the sort key to resume after. */
  async page(
    partition: ProductListPartition,
    filters: SearchableProductFilters,
    limit: number,
    after?: string,
  ): Promise<{ ids: string[]; next?: string } | null> {
    const data = await this.ask({ mode: 'page', partition, limit, ...(after && { after }), filters });
    if (!data) return null;
    if (!Array.isArray(data.ids) || !data.ids.every((id: unknown) => typeof id === 'string')) {
      return this.distrust('a page without ids');
    }
    return { ids: data.ids, ...(typeof data.next === 'string' && { next: data.next }) };
  }

  /** How many products the filters select, exactly. */
  async count(partition: ProductListPartition, filters: SearchableProductFilters): Promise<number | null> {
    const data = await this.ask({ mode: 'count', partition, filters });
    if (!data) return null;
    if (typeof data.total !== 'number' || !Number.isFinite(data.total)) return this.distrust('a count without a total');
    return data.total;
  }

  private distrust(what: string): null {
    this.logger.warn(`search answered ${what} — reading DynamoDB`);
    this.restUntil = this.now() + FAILURE_REST_MS;
    return null;
  }

  private async ask(body: Record<string, unknown>): Promise<any | null> {
    if (!this.baseUrl) return null;
    if (this.now() < this.restUntil) return null;
    try {
      const res = await this.fetchFn(`${this.baseUrl}/api/search/internal/products/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-secret': this.secret },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) {
        this.logger.warn(`search product list answered HTTP ${res.status} — reading DynamoDB`);
        this.restUntil = this.now() + FAILURE_REST_MS;
        return null;
      }
      const json: any = await res.json();
      const data = json?.data ?? json;
      if (data?.ready !== true) {
        this.restUntil = this.now() + NOT_READY_REST_MS;
        return null;
      }
      return data;
    } catch (err) {
      this.logger.warn(`search product list unavailable (${(err as Error)?.name}: ${(err as Error)?.message}) — reading DynamoDB`);
      this.restUntil = this.now() + FAILURE_REST_MS;
      return null;
    }
  }
}
