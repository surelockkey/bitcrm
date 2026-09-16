import { Injectable, Logger, Optional } from '@nestjs/common';
import { BusinessMetricsService } from '@bitcrm/shared';
import { SearchType } from '@bitcrm/types';
import { SearchIndexerService } from './indexer.service';
import { EntityFetcher, UnsupportedEntityError } from './entity-fetcher.service';
import { CatalogNamesService } from './catalog-names.service';
import { BackfillService } from './backfill/backfill.service';

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
    private readonly catalogNames: CatalogNamesService,
    private readonly backfill: BackfillService,
    @Optional() private readonly metrics?: BusinessMetricsService,
  ) {}

  /** Re-fetch + re-index the entity referenced by an event. */
  async onUpsert(type: SearchType, entityId: string): Promise<void> {
    const timer = this.metrics?.sqsProcessingDuration?.startTimer?.({
      event_type: `search.${type}.upsert`,
    });
    // 'upsert' until the fetch says otherwise: a 404 means the entity is
    // gone and this becomes a removal.
    let operation: 'upsert' | 'delete' = 'upsert';
    try {
      const entity = await this.fetcher.fetch(type, entityId);
      if (!entity) {
        // Entity gone (404) → treat as delete.
        operation = 'delete';
        await this.indexer.remove(type, entityId);
      } else {
        await this.indexer.indexEntity(type, entity);
      }
      // Deal docs denormalize their client (name/phone/email), so a client
      // edit must rebuild every deal that references it.
      if (type === 'contact' || type === 'company') {
        await this.reindexClientDeals(type, entityId);
      }
      // Conversation docs carry the party's live name and, for `assigned_only`,
      // the roster of the jobs they reference — rebuild them when the party is
      // edited or a referenced job changes hands.
      if (type === 'contact' || type === 'company' || type === 'user') {
        await this.reindexPartyConversations(type, entityId);
      }
      if (type === 'deal') {
        await this.reindexDealConversations(entityId);
      }
      timer?.();
      this.metrics?.sqsMessagesProcessed?.inc?.({
        event_type: `search.${type}`,
        status: 'success',
      });
      this.metrics?.searchIndexOperations.inc({
        type,
        operation,
        status: 'success',
      });
    } catch (err) {
      timer?.();
      if (err instanceof UnsupportedEntityError) {
        // No single-entity endpoint — leave to the backfill, don't delete.
        // Counted as skipped, not error: this is expected, and it must not
        // show up in the index error rate.
        this.metrics?.searchIndexOperations.inc({
          type,
          operation,
          status: 'skipped',
        });
        this.logger.debug(`Skipping ${type}#${entityId}: ${err.message}`);
        return;
      }
      this.metrics?.sqsMessagesProcessed?.inc?.({
        event_type: `search.${type}`,
        status: 'error',
      });
      this.metrics?.searchIndexOperations.inc({
        type,
        operation,
        status: 'error',
      });
      this.logger.error(
        `Failed to index ${type}#${entityId}: ${(err as Error).message}`,
      );
      throw err; // let SQS retry → DLQ
    }
  }

  async onDelete(type: SearchType, entityId: string): Promise<void> {
    try {
      await this.indexer.remove(type, entityId);
      this.metrics?.searchIndexOperations.inc({
        type,
        operation: 'delete',
        status: 'success',
      });
    } catch (err) {
      this.metrics?.searchIndexOperations.inc({
        type,
        operation: 'delete',
        status: 'error',
      });
      throw err; // let SQS retry → DLQ
    }
  }

  /**
   * A custom-field definition changed (created/updated/archived/deleted). The
   * `searchable` toggle lives there, so drop the cached defs and rebuild every
   * deal doc — toggling a field on must make already-stored answers findable.
   */
  async onCustomFieldsChanged(): Promise<void> {
    this.catalogNames.invalidateCustomFields();
    await this.backfill.run(['deal']);
  }

  /** Rebuild the deal docs that denormalized this contact/company. */
  private async reindexClientDeals(
    type: 'contact' | 'company',
    id: string,
  ): Promise<void> {
    const field = type === 'contact' ? 'contactId' : 'companyId';
    const dealIds = await this.indexer.findDealIdsBy(field, id);
    for (const dealId of dealIds) {
      const deal = await this.fetcher.fetch('deal', dealId);
      if (deal) await this.indexer.indexEntity('deal', deal);
      else await this.indexer.remove('deal', dealId);
    }
    if (dealIds.length > 0) {
      this.logger.debug(`Reindexed ${dealIds.length} deals for ${type}#${id}`);
    }
  }

  /** Rebuild the conversation docs whose party is this contact / company / user. */
  private async reindexPartyConversations(
    type: 'contact' | 'company' | 'user',
    id: string,
  ): Promise<void> {
    const ids = await this.indexer.findConversationIdsByParty(type, id);
    await this.reindexConversations(ids, `${type}#${id}`);
  }

  /** Rebuild the conversation docs that reference this job (its roster is their `ownerIds`). */
  private async reindexDealConversations(dealId: string): Promise<void> {
    const ids = await this.indexer.findConversationIdsByDeal(dealId);
    await this.reindexConversations(ids, `deal#${dealId}`);
  }

  private async reindexConversations(ids: string[], reason: string): Promise<void> {
    for (const conversationId of ids) {
      const conversation = await this.fetcher.fetch('conversation', conversationId);
      if (conversation) await this.indexer.indexEntity('conversation', conversation);
      else await this.indexer.remove('conversation', conversationId);
    }
    if (ids.length > 0) {
      this.logger.debug(`Reindexed ${ids.length} conversations for ${reason}`);
    }
  }
}
