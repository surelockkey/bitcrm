import {
  SearchHit,
  SearchGroup,
  SearchMode,
  SearchResponse,
  SearchType,
} from '@bitcrm/types';

interface ParseContext {
  query: string;
  mode: SearchMode;
  page?: number;
  size?: number;
}

interface OsHit {
  _score: number;
  _source: {
    entityId: string;
    type: SearchType;
    title: string;
    subtitle?: string;
    badges?: string[];
    url?: string;
  };
}

function toHit(hit: OsHit): SearchHit {
  const s = hit._source;
  return {
    entityId: s.entityId,
    type: s.type,
    title: s.title,
    subtitle: s.subtitle,
    badges: s.badges ?? [],
    url: s.url,
    score: hit._score,
  };
}

/**
 * Reshapes a raw OpenSearch response into our stable SearchResponse contract.
 * Typeahead → groups (one per type bucket, each with its own total + top hits).
 * Full → a flat relevance-ordered `hits` page plus per-type `facets` and totals.
 */
export function parseSearchResponse(
  raw: any,
  ctx: ParseContext,
): SearchResponse {
  const took = raw?.took ?? 0;
  const buckets: any[] = raw?.aggregations?.types?.buckets ?? [];

  if (ctx.mode === 'typeahead') {
    const groups: SearchGroup[] = buckets.map((b) => ({
      type: b.key as SearchType,
      total: b.doc_count,
      items: (b.top?.hits?.hits ?? []).map(toHit),
    }));
    return { query: ctx.query, mode: 'typeahead', groups, took };
  }

  // full mode
  const hits: SearchHit[] = (raw?.hits?.hits ?? []).map(toHit);
  const facets: Partial<Record<SearchType, number>> = {};
  for (const b of buckets) {
    facets[b.key as SearchType] = b.doc_count;
  }
  const total =
    typeof raw?.hits?.total === 'number'
      ? raw.hits.total
      : raw?.hits?.total?.value ?? 0;

  return {
    query: ctx.query,
    mode: 'full',
    groups: [],
    hits,
    facets,
    total,
    page: ctx.page ?? 1,
    size: ctx.size ?? hits.length,
    took,
  };
}
