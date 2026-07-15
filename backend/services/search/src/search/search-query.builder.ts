import { SearchMode, SearchType, SEARCH_TYPES } from '@bitcrm/types';
import { FIELD_BOOSTS } from '../common/constants/opensearch.constants';
import { QueryClause } from './authz/search-authz.builder';

export interface BuildSearchParams {
  q: string;
  /** Authorization clause from buildAuthorizationClause — always applied. */
  authzClause: QueryClause;
  mode: SearchMode;
  /** Restrict to these entity types (facet filter). */
  types?: SearchType[];
  /** typeahead: hits returned per type bucket. */
  perTypeLimit?: number;
  /** full: 1-based page. */
  page?: number;
  /** full: page size. */
  size?: number;
}

const DEFAULT_PER_TYPE_LIMIT = 5;
const DEFAULT_PAGE_SIZE = 20;

/** Source fields the client needs to render a hit (no over-fetching). */
const DISPLAY_SOURCE = [
  'entityId',
  'type',
  'title',
  'subtitle',
  'badges',
  'url',
];

const FIELDS = [
  `title^${FIELD_BOOSTS.title}`,
  `keywords^${FIELD_BOOSTS.keywords}`,
  `subtitle^${FIELD_BOOSTS.subtitle}`,
  `body^${FIELD_BOOSTS.body}`,
];

/**
 * Builds the OpenSearch request body. The text match runs against edge-ngram
 * indexed fields (so it matches prefixes for typeahead) and is wrapped in a
 * recency decay so newer entities rank higher among equally-relevant matches.
 * Authorization + status hygiene live in the bool filter / must_not.
 */
export function buildSearchBody(params: BuildSearchParams): Record<string, any> {
  const { q, authzClause, mode, types } = params;

  const filter: QueryClause[] = [authzClause];
  if (types && types.length > 0) {
    filter.push({ terms: { type: types } });
  }

  const scoredQuery = {
    function_score: {
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query: q,
                fields: FIELDS,
                fuzziness: 'AUTO',
                operator: 'and',
              },
            },
          ],
          filter,
          must_not: [{ terms: { status: ['deleted', 'archived'] } }],
        },
      },
      functions: [
        { gauss: { updatedAt: { origin: 'now', scale: '30d', decay: 0.5 } } },
      ],
      score_mode: 'multiply',
      boost_mode: 'multiply',
    },
  };

  if (mode === 'typeahead') {
    const perType = params.perTypeLimit ?? DEFAULT_PER_TYPE_LIMIT;
    return {
      size: 0,
      query: scoredQuery,
      aggs: {
        types: {
          terms: { field: 'type', size: SEARCH_TYPES.length },
          aggs: {
            top: {
              top_hits: { size: perType, _source: DISPLAY_SOURCE },
            },
          },
        },
      },
    };
  }

  // full mode
  const size = params.size ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, params.page ?? 1);
  return {
    from: (page - 1) * size,
    size,
    _source: DISPLAY_SOURCE,
    query: scoredQuery,
    aggs: {
      types: { terms: { field: 'type', size: SEARCH_TYPES.length } },
    },
  };
}
