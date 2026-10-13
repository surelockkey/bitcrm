import { Injectable } from '@nestjs/common';
import { OpenSearchService } from '../common/opensearch/opensearch.service';
import { SEARCH_INDEX_ALIAS } from '../common/constants/opensearch.constants';
import { ProductListReadiness } from './product-list.readiness';
import { buildProductListBody, type ProductListQuery } from './product-list.query';

export type ProductListPage = { ready: false } | { ready: true; ids: string[]; next?: string };
export type ProductListCount = { ready: false } | { ready: true; total: number };

/**
 * The read side of inventory's filtered Price Book. Ids only: inventory loads
 * the rows itself (its product cache, then one BatchGet), so the answer is
 * always the stored product, never a stale copy of it.
 */
@Injectable()
export class ProductListService {
  constructor(
    private readonly opensearch: OpenSearchService,
    private readonly readiness: ProductListReadiness,
  ) {}

  async page(q: ProductListQuery): Promise<ProductListPage> {
    if (!(await this.readiness.isReady())) return { ready: false };
    const res: any = await this.opensearch.client.search({
      index: SEARCH_INDEX_ALIAS,
      body: buildProductListBody(q, 'page'),
    });
    const hits: any[] = res?.body?.hits?.hits ?? [];
    const kept = hits.slice(0, q.limit);
    const ids = kept.map((h) => h?._source?.entityId).filter((id): id is string => typeof id === 'string');
    const more = hits.length > q.limit;
    const next = more ? kept[kept.length - 1]?.sort?.[0] : undefined;
    return { ready: true, ids, ...(typeof next === 'string' && { next }) };
  }

  async count(q: ProductListQuery): Promise<ProductListCount> {
    if (!(await this.readiness.isReady())) return { ready: false };
    const res: any = await this.opensearch.client.search({
      index: SEARCH_INDEX_ALIAS,
      body: buildProductListBody(q, 'count'),
    });
    const total = res?.body?.hits?.total;
    return { ready: true, total: typeof total === 'number' ? total : Number(total?.value ?? 0) };
  }
}
