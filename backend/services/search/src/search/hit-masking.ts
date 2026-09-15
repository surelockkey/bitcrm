import { SearchHit, SearchResponse } from '@bitcrm/types';
import { looksLikePhone } from '../common/utils/search-normalize.util';

/** What a number-only thread is called for a viewer who may not see the number. */
export const MASKED_CONVERSATION_TITLE = 'Unknown number';

/**
 * Client phone numbers are gated by `contacts.view_numbers` wherever they
 * surface (messaging design §7.5, same rule as the call log). Search hits
 * carry no addresses — only `title`, `subtitle`, `badges` — but a thread
 * with nobody behind it in CRM is titled by its number, so that one title
 * is withheld here. Everything else (a name, an email, the preview) stays.
 * Always copies: the response object is not shared, but the rule is the
 * same as the masking helpers elsewhere.
 */
export function maskHit(hit: SearchHit, allowed: boolean): SearchHit {
  if (allowed || hit.type !== 'conversation' || !looksLikePhone(hit.title)) return hit;
  return { ...hit, title: MASKED_CONVERSATION_TITLE };
}

export function maskSearchResponse(response: SearchResponse, allowed: boolean): SearchResponse {
  if (allowed) return response;
  return {
    ...response,
    groups: response.groups.map((g) => ({ ...g, items: g.items.map((h) => maskHit(h, false)) })),
    hits: response.hits?.map((h) => maskHit(h, false)),
  };
}
