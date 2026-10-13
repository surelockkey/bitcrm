import { Injectable, Logger } from '@nestjs/common';
import { OpenSearchService } from '../common/opensearch/opensearch.service';
import { SEARCH_INDEX_ALIAS } from '../common/constants/opensearch.constants';

/** The meta document's id — not `${type}#${id}` of any entity. */
export const PRODUCT_LIST_META_ID = 'meta#product-list';

/**
 * Which `productList` shape the stamp vouches for. Bump it with any change to
 * `product-list.fields.ts` that old documents would answer wrongly; the list
 * then reads as not ready until a product backfill re-stamps it.
 */
export const PRODUCT_LIST_SCHEMA = 1;

/** How long an answer is kept — either way, so an alias swap is noticed within a minute. */
const RECHECK_MS = 60_000;

/**
 * Whether the index the alias points at holds every product with its
 * `productList` fields. The product backfill stamps a meta document into
 * that index once it has written every product; a new index version (or the
 * one an alias swap just moved to) starts without it, so inventory keeps its
 * DynamoDB path until the backfill has run there.
 *
 * The meta document has no text fields (no global-search query can match
 * it), is `archived` (excluded by every query's status hygiene) and of type
 * `meta` (in no type facet).
 */
@Injectable()
export class ProductListReadiness {
  private readonly logger = new Logger(ProductListReadiness.name);
  private known?: { ready: boolean; at: number };

  constructor(private readonly opensearch: OpenSearchService) {}

  async isReady(now: number = Date.now()): Promise<boolean> {
    if (this.known && now - this.known.at < RECHECK_MS) return this.known.ready;
    let ready = false;
    try {
      const res: any = await this.opensearch.client.get({ index: SEARCH_INDEX_ALIAS, id: PRODUCT_LIST_META_ID });
      const src = res?.body?._source;
      ready = src?.schema === PRODUCT_LIST_SCHEMA && typeof src?.productListReadyAt === 'string';
    } catch (err: any) {
      if (err?.meta?.statusCode !== 404) {
        this.logger.warn(`product list readiness unreadable — treated as not ready: ${err?.message}`);
      }
    }
    this.known = { ready, at: now };
    return ready;
  }

  /** Called by the backfill once every product document was written. */
  async stamp(count: number): Promise<void> {
    await this.opensearch.client.index({
      index: SEARCH_INDEX_ALIAS,
      id: PRODUCT_LIST_META_ID,
      body: {
        docId: PRODUCT_LIST_META_ID,
        entityId: 'product-list',
        type: 'meta',
        status: 'archived',
        ownerIds: [],
        schema: PRODUCT_LIST_SCHEMA,
        productListReadyAt: new Date().toISOString(),
        count,
      },
      // No refresh needed: readiness is read with GET by id, which is realtime
      // (and OpenSearch Serverless refuses refresh=true).
    });
    this.known = { ready: true, at: Date.now() };
    this.logger.log(`Product list stamped ready (${count} products, schema ${PRODUCT_LIST_SCHEMA})`);
  }
}
