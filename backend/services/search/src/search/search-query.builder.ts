import { SearchMode, SearchType, SEARCH_TYPES } from '@bitcrm/types';
import { FIELD_BOOSTS } from '../common/constants/opensearch.constants';
import { phoneQueryDigits, phoneQueryTerms } from '../common/utils/search-normalize.util';
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

/**
 * What a search that names no types leaves out: the item catalog — products,
 * and the stock rows derived from them. Workiz's global search doesn't find
 * items, and the owner wants the same here ("в воркізі не можна так шукати
 * товари то і нам не треба"). The documents stay indexed: a caller that asks
 * for them by name (`type=product`) still gets them.
 */
export const LEFT_OUT_BY_DEFAULT: readonly SearchType[] = ['product', 'stock'];

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

/** Fewest digits that make a whole phone number (a local 7-digit one); fewer is a fragment. */
const MIN_PHONE_NUMBER_DIGITS = 7;
/** Constant scores of the phone clauses — far above any text score, so a number's owner ranks first. */
const PHONE_EXACT_BOOST = 100;
const PHONE_PREFIX_BOOST = 20;
const PHONE_FRAGMENT_BOOST = 5;

/**
 * A phone-like query ("(728) 347-8370", "+1 728 347 8370", "8370") is looked
 * up by its collapsed digits — never fuzzily: one wrong digit is a different
 * number, and the old fuzzy clause let a 10-digit number match records two
 * digits off and every edge-ngram fragment, so a client's own (second)
 * number could fall out of the top 5 behind unrelated records.
 *
 * - a whole number (7+ digits) matches the exact `phoneDigits` variants
 *   (with and without a leading +1) and ranks first;
 * - a prefix of a variant — a number still being typed, or any 4+ digit run
 *   inside a number, since the variants hold every suffix — ranks next;
 * - the digits also match the text fields exactly (no fuzziness), which keeps
 *   job numbers, zips and PO numbers findable.
 */
function buildPhoneMatchClause(digits: string): Record<string, any> {
  const should: Record<string, any>[] = [];
  if (digits.length >= MIN_PHONE_NUMBER_DIGITS) {
    should.push(
      { constant_score: { filter: { terms: { phoneDigits: phoneQueryTerms(digits) } }, boost: PHONE_EXACT_BOOST } },
      { constant_score: { filter: { prefix: { phoneDigits: digits } }, boost: PHONE_PREFIX_BOOST } },
    );
  } else {
    should.push({
      constant_score: { filter: { prefix: { phoneDigits: digits } }, boost: PHONE_FRAGMENT_BOOST },
    });
  }
  should.push({ multi_match: { query: digits, fields: FIELDS, operator: 'and' } });
  return { bool: { should, minimum_should_match: 1 } };
}

/** The match clause for ordinary text: fuzzy, every word required. */
function buildTextMatchClause(q: string): Record<string, any> {
  return {
    multi_match: {
      query: q,
      fields: FIELDS,
      fuzziness: 'AUTO',
      operator: 'and',
    },
  };
}

/**
 * The same words without fuzziness, as a scoring bonus: an exact (or prefix)
 * hit — "cbre" in "CBRE Facilities Management" — must outrank a typo-distance
 * one ("Corey Barrettt"). For a phone query the words are its digits.
 */
function exactBonus(q: string): Record<string, any> {
  return { multi_match: { query: q, fields: FIELDS, operator: 'and', boost: EXACT_BOOST } };
}
const EXACT_BOOST = 3;

/**
 * Recency as a nudge, not a gate: the score is multiplied by 1 + 0.5·decay,
 * so a fresh document gets up to half again and an old one keeps its full
 * text relevance. A bare decay (multiplying by ~0 past a few months) buried
 * every Workiz-imported client under any recent fuzzy match.
 */
const RECENCY_FUNCTIONS = [
  { gauss: { updatedAt: { origin: 'now', scale: '30d', decay: 0.5 } }, weight: 0.5 },
  { weight: 1 },
];

/**
 * Builds the OpenSearch request body. The text match runs against edge-ngram
 * indexed fields (so it matches prefixes for typeahead), an exact match
 * scores above a fuzzy one, and recency nudges equally relevant matches.
 * A phone-like query takes the exact phone path instead (no fuzziness).
 * Authorization + status hygiene live in the bool filter / must_not.
 */
export function buildSearchBody(params: BuildSearchParams): Record<string, any> {
  const { q, authzClause, mode, types } = params;

  const filter: QueryClause[] = [authzClause];
  const mustNot: QueryClause[] = [{ terms: { status: ['deleted', 'archived'] } }];
  if (types && types.length > 0) {
    filter.push({ terms: { type: types } });
  } else {
    mustNot.push({ terms: { type: [...LEFT_OUT_BY_DEFAULT] } });
  }

  const phoneDigits = phoneQueryDigits(q);
  const scoredQuery = {
    function_score: {
      query: {
        bool: {
          must: [phoneDigits ? buildPhoneMatchClause(phoneDigits) : buildTextMatchClause(q)],
          should: [exactBonus(phoneDigits ?? q)],
          filter,
          must_not: mustNot,
        },
      },
      functions: RECENCY_FUNCTIONS,
      score_mode: 'sum',
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
