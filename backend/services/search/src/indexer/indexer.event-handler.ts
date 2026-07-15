import { Injectable, Logger, Optional } from '@nestjs/common';
import { BusinessMetricsService } from '@bitcrm/shared';
import { SearchType } from '@bitcrm/types';
import { SearchIndexerService } from './indexer.service';
import { EntityFetcher, UnsupportedEntityError } from './entity-fetcher.service';

/**
 * Turns cross-service events into index updates. Domain events carry only ids +
 * changed fields, so on an upsert event we re-fetch the authoritative entity from
 * the owning service (via internal HTTP) and re-index it; delete events remove the
 * doc directly. This keeps the index fresh; the backfill guarantees completeness.
 */
@Injectable()
export class IndexerEventHandler {
  private readonly logger = new Logger(IndexerEventHandler.name);

  constructor(
    private readonly indexer: SearchIndexerService,
    private readonly fetcher: EntityFetcher,
    @Optional() private readonly metrics?: BusinessMetricsService,
  ) {}

  /** Re-fetch + re-index the entity referenced by an event. */
  async onUpsert(type: SearchType, entityId: string): Promise<void> {
    const timer = this.metrics?.sqsProcessingDuration?.startTimer?.({
      event_type: `search.${type}.upsert`,
    });
    try {
      const entity = await this.fetcher.fetch(type, entityId);
      if (!entity) {
        // Entity gone (404) → treat as delete.
        await this.indexer.remove(type, entityId);
      } else {
        await this.indexer.indexEntity(type, entity);
      }
      timer?.();
      this.metrics?.sqsMessagesProcessed?.inc?.({
        event_type: `search.${type}`,
        status: 'success',
      });
    } catch (err) {
      timer?.();
      if (err instanceof UnsupportedEntityError) {
        // No single-entity endpoint — leave to the backfill, don't delete.
        this.logger.debug(`Skipping ${type}#${entityId}: ${err.message}`);
        return;
      }
      this.metrics?.sqsMessagesProcessed?.inc?.({
        event_type: `search.${type}`,
        status: 'error',
      });
      this.logger.error(
        `Failed to index ${type}#${entityId}: ${(err as Error).message}`,
      );
      throw err; // let SQS retry → DLQ
    }
  }

  async onDelete(type: SearchType, entityId: string): Promise<void> {
    await this.indexer.remove(type, entityId);
  }
}
