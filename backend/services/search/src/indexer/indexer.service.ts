import { Injectable, Logger } from '@nestjs/common';
import { SearchDocument, SearchType } from '@bitcrm/types';
import { OpenSearchService } from '../common/opensearch/opensearch.service';
import { SEARCH_INDEX_ALIAS } from '../common/constants/opensearch.constants';
import { routeToDocument } from './index-router';
import { CatalogNamesService } from './catalog-names.service';
import { EntityFetcher } from './entity-fetcher.service';
import { DealClientSearchInput } from './mappers/mapper-input';

/** Upper bound on deals rebuilt when one client changes (a client with more is pathological). */
const MAX_DEALS_PER_CLIENT = 1000;

/**
 * Write side of the CQRS index. Upserts and deletes single documents (used by the
 * SQS event handlers) and bulk-upserts (used by the backfill). Idempotent: docs
 * are keyed by `${type}#${entityId}`, so replays and out-of-order events converge.
 */
@Injectable()
export class SearchIndexerService {
  private readonly logger = new Logger(SearchIndexerService.name);

  constructor(
    private readonly opensearch: OpenSearchService,
    private readonly catalogNames: CatalogNamesService,
    private readonly fetcher: EntityFetcher,
  ) {}

  /** Map a full entity to a document and upsert it. */
  async indexEntity(type: SearchType, entity: any): Promise<void> {
    // Deals carry a job-type id and job-tag ids; search shows the names.
    const jobTypeName =
      type === 'deal'
        ? await this.catalogNames.nameOf('job-types', entity?.jobTypeId)
        : undefined;
    const tagNames =
      type === 'deal' ? await this.resolveTagNames(entity?.tagIds) : [];
    const customFieldDefs =
      type === 'deal' ? await this.catalogNames.customFieldDefs() : [];
    const client =
      type === 'deal' ? await this.resolveDealClient(entity) : undefined;
    const externalCompanyName =
      type === 'deal'
        ? await this.catalogNames.nameOf('external-companies', entity?.externalCompanyId)
        : undefined;
    const doc = routeToDocument(
      type,
      entity,
      jobTypeName,
      tagNames,
      customFieldDefs,
      client,
      externalCompanyName,
    );
    if (!doc) {
      this.logger.warn(`No mapper for type "${type}", skipping`);
      return;
    }
    await this.indexDocument(doc);
  }

  /**
   * The deal's client slice (contact name/phones/emails + company name) for the
   * mapper. Fetch failures degrade to an unenriched doc — a findable deal
   * without client keywords beats an unindexed one. `cache` (keyed
   * `type#id`) lets the backfill reuse fetches across a page of deals.
   */
  async resolveDealClient(
    deal: any,
    cache?: Map<string, any | null>,
  ): Promise<DealClientSearchInput | undefined> {
    const fetchCached = async (type: 'contact' | 'company', id: string) => {
      const key = `${type}#${id}`;
      if (cache?.has(key)) return cache.get(key);
      const entity = await this.fetcher.fetch(type, id).catch((err) => {
        this.logger.warn(`Client fetch ${key} failed: ${(err as Error).message}`);
        return null;
      });
      cache?.set(key, entity);
      return entity;
    };

    const [contact, company] = await Promise.all([
      deal?.contactId ? fetchCached('contact', deal.contactId) : null,
      deal?.companyId ? fetchCached('company', deal.companyId) : null,
    ]);
    if (!contact && !company) return undefined;

    return {
      name: contact
        ? `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || undefined
        : undefined,
      phones: contact?.phones,
      emails: contact?.emails,
      companyName: company?.title,
    };
  }

  /**
   * Deal ids whose docs reference this contact/company — the reindex fan-out
   * when a client's name or phone changes.
   */
  async findDealIdsBy(
    field: 'contactId' | 'companyId',
    id: string,
  ): Promise<string[]> {
    const res: any = await this.opensearch.client.search({
      index: SEARCH_INDEX_ALIAS,
      body: {
        size: MAX_DEALS_PER_CLIENT,
        _source: ['entityId'],
        query: {
          bool: {
            filter: [{ term: { type: 'deal' } }, { term: { [field]: id } }],
          },
        },
      },
    });
    const hits = res.body?.hits?.hits ?? [];
    return hits
      .map((h: any) => h._source?.entityId)
      .filter((v: any): v is string => Boolean(v));
  }

  /** Resolve a deal's job-tag ids to names (dropping any that no longer exist). */
  private async resolveTagNames(tagIds?: string[]): Promise<string[]> {
    if (!tagIds?.length) return [];
    const names = await Promise.all(
      tagIds.map((id) => this.catalogNames.nameOf('job-tags', id)),
    );
    return names.filter((n): n is string => Boolean(n));
  }

  async indexDocument(doc: SearchDocument): Promise<void> {
    await this.opensearch.client.index({
      index: SEARCH_INDEX_ALIAS,
      id: doc.docId,
      body: doc,
      refresh: false,
    });
    this.logger.debug(`Indexed ${doc.docId}`);
  }

  /** Bulk upsert (backfill). Returns the number of docs written. */
  async bulkIndex(docs: SearchDocument[]): Promise<number> {
    if (docs.length === 0) return 0;
    const operations = docs.flatMap((doc) => [
      { index: { _index: SEARCH_INDEX_ALIAS, _id: doc.docId } },
      doc,
    ]);
    const res: any = await this.opensearch.client.bulk({
      body: operations,
      refresh: false,
    });
    if (res.body?.errors) {
      const failed = (res.body.items || []).filter((i: any) => i.index?.error);
      this.logger.error(`Bulk index had ${failed.length} failures`);
    }
    return docs.length;
  }

  async remove(type: SearchType, entityId: string): Promise<void> {
    try {
      await this.opensearch.client.delete({
        index: SEARCH_INDEX_ALIAS,
        id: `${type}#${entityId}`,
      });
      this.logger.debug(`Removed ${type}#${entityId}`);
    } catch (err: any) {
      // A delete for an unindexed doc is fine (idempotent).
      if (err?.meta?.statusCode !== 404) throw err;
    }
  }
}
