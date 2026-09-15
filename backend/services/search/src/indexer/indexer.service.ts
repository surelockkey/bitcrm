import { Injectable, Logger } from '@nestjs/common';
import { ConversationPartyKind, SearchDocument, SearchType } from '@bitcrm/types';
import { OpenSearchService } from '../common/opensearch/opensearch.service';
import { SEARCH_INDEX_ALIAS } from '../common/constants/opensearch.constants';
import { compactUnique } from '../common/utils/search-normalize.util';
import { routeToDocument } from './index-router';
import { CatalogNamesService } from './catalog-names.service';
import { EntityFetcher } from './entity-fetcher.service';
import {
  ConversationDealSearchInput,
  ConversationSearchInput,
  DealClientSearchInput,
} from './mappers/mapper-input';

/** Upper bound on deals rebuilt when one client changes (a client with more is pathological). */
const MAX_DEALS_PER_CLIENT = 1000;

/**
 * How many of a conversation's newest messages are folded into its document
 * (messaging design §7.4 keeps the full 2.26M-message history out of this
 * index; the last page is what a searcher remembers). Bounded per message
 * by the mapper.
 */
export const CONVERSATION_MESSAGES = Math.max(
  1,
  Number(process.env.SEARCH_CONVERSATION_MESSAGES) || 20,
);

/** Jobs resolved per conversation (roster + number); a thread rarely references more. */
const MAX_DEALS_PER_CONVERSATION = 10;

/** Party kinds whose display name lives in another service. */
const PARTY_ENTITY: Partial<Record<ConversationPartyKind, 'contact' | 'company' | 'user'>> = {
  contact: 'contact',
  company: 'company',
  user: 'user',
};

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
    const conversation =
      type === 'conversation' ? await this.resolveConversationContext(entity) : undefined;
    const doc = routeToDocument(
      type,
      entity,
      jobTypeName,
      tagNames,
      customFieldDefs,
      client,
      externalCompanyName,
      conversation,
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
    const [contact, company] = await Promise.all([
      deal?.contactId ? this.fetchCached('contact', deal.contactId, cache) : null,
      deal?.companyId ? this.fetchCached('company', deal.companyId, cache) : null,
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
   * Everything the conversation mapper needs beyond the stored thread
   * (messaging design §7.4): the party's live name and addresses, the last
   * CONVERSATION_MESSAGES lines of the feed, and the jobs those lines (and
   * `lastDealId`) point at — number for keywords, roster for `assigned_only`.
   * Every lookup degrades to "unknown" rather than failing the document: a
   * thread findable by its number beats one missing from the index. `cache`
   * (keyed `type#id`) lets the backfill reuse party and deal fetches.
   */
  async resolveConversationContext(
    conversation: any,
    cache?: Map<string, any | null>,
  ): Promise<ConversationSearchInput> {
    const id = conversation?.id;
    const messages: any[] = id
      ? await this.fetcher.fetchConversationMessages(id, CONVERSATION_MESSAGES).catch((err) => {
          this.logger.warn(`Messages fetch for conversation#${id} failed: ${(err as Error).message}`);
          return [];
        })
      : [];

    const dealIds = compactUnique([
      conversation?.lastDealId,
      ...messages.map((m) => m?.dealId),
    ]).slice(0, MAX_DEALS_PER_CONVERSATION);
    const deals = (
      await Promise.all(dealIds.map((dealId) => this.fetchCached('deal', dealId, cache)))
    )
      .map((deal, i): ConversationDealSearchInput | null =>
        deal
          ? { id: dealIds[i], dealNumber: deal.dealNumber, assignedTechIds: deal.assignedTechIds ?? [] }
          : null,
      )
      .filter((d): d is ConversationDealSearchInput => d !== null);

    const partyType = PARTY_ENTITY[conversation?.partyKind as ConversationPartyKind];
    const party =
      partyType && conversation?.partyId
        ? await this.fetchCached(partyType, conversation.partyId, cache)
        : null;

    return {
      partyName: party ? partyDisplayName(partyType!, party) : undefined,
      partyPhones: party?.phones,
      partyEmails: party?.emails,
      messages: messages.map((m) => ({
        id: m?.id,
        body: m?.body,
        subject: m?.subject,
        dealId: m?.dealId,
        createdAt: m?.createdAt,
      })),
      deals,
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
    return this.findIdsBy('deal', field, id);
  }

  /**
   * Conversation ids whose thread is with this party — the reindex fan-out
   * when a contact, company or user is renamed or gets a new number.
   */
  async findConversationIdsByParty(
    kind: 'contact' | 'company' | 'user',
    id: string,
  ): Promise<string[]> {
    return this.findIdsBy('conversation', 'partyId', id, [{ term: { partyKind: kind } }]);
  }

  /** Conversation ids whose thread references this job — rebuilt when the roster changes. */
  async findConversationIdsByDeal(dealId: string): Promise<string[]> {
    return this.findIdsBy('conversation', 'dealIds', dealId);
  }

  /** Entity ids of `type` whose doc has `field = value` (bounded, ids only). */
  private async findIdsBy(
    type: SearchType,
    field: string,
    value: string,
    extraFilters: Record<string, any>[] = [],
  ): Promise<string[]> {
    const res: any = await this.opensearch.client.search({
      index: SEARCH_INDEX_ALIAS,
      body: {
        size: MAX_DEALS_PER_CLIENT,
        _source: ['entityId'],
        query: {
          bool: {
            filter: [{ term: { type } }, { term: { [field]: value } }, ...extraFilters],
          },
        },
      },
    });
    const hits = res.body?.hits?.hits ?? [];
    return hits
      .map((h: any) => h._source?.entityId)
      .filter((v: any): v is string => Boolean(v));
  }

  /** One internal fetch, memoised in `cache` (keyed `type#id`); a failure is a null, logged once. */
  private async fetchCached(
    type: 'contact' | 'company' | 'user' | 'deal',
    id: string,
    cache?: Map<string, any | null>,
  ): Promise<any | null> {
    const key = `${type}#${id}`;
    if (cache?.has(key)) return cache.get(key);
    const entity = await this.fetcher.fetch(type, id).catch((err) => {
      this.logger.warn(`Fetch ${key} failed: ${(err as Error).message}`);
      return null;
    });
    cache?.set(key, entity);
    return entity;
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

/** The party's display name as the inbox shows it (contact / user: first + last; company: title). */
function partyDisplayName(type: 'contact' | 'company' | 'user', party: any): string | undefined {
  if (type === 'company') return party?.title?.trim() || undefined;
  return `${party?.firstName ?? ''} ${party?.lastName ?? ''}`.trim() || party?.email || undefined;
}
