import { Injectable, Logger } from '@nestjs/common';
import { SearchDocument, SearchType } from '@bitcrm/types';
import { OpenSearchService } from '../common/opensearch/opensearch.service';
import { SEARCH_INDEX_ALIAS } from '../common/constants/opensearch.constants';
import { routeToDocument } from './index-router';
import { CatalogNamesService } from './catalog-names.service';

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
  ) {}

  /** Map a full entity to a document and upsert it. */
  async indexEntity(type: SearchType, entity: any): Promise<void> {
    // Deals carry a job-type id; search shows the name.
    const jobTypeName =
      type === 'deal'
        ? await this.catalogNames.nameOf('job-types', entity?.jobTypeId)
        : undefined;
    const doc = routeToDocument(type, entity, jobTypeName);
    if (!doc) {
      this.logger.warn(`No mapper for type "${type}", skipping`);
      return;
    }
    await this.indexDocument(doc);
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
