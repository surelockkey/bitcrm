/**
 * The call log's Search box (`GET /calls?q=`), the Workiz way: a piece of the
 * caller's or callee's name, or digits of either number.
 *
 * A call row holds its parties as ids (`fromPartyId` / `toPartyId`), and the
 * names are resolved at read time so a rename shows through. DynamoDB can only
 * match what is on the row, so the row also carries `partyNames`: both sides'
 * names, folded (lower case, accents off, one space) and newline apart — a
 * newline the box can never send, so no match runs from one name into the
 * other. Its writers:
 *
 *  - the log's own read path, whenever it has just named a finished call and
 *    the names differ from the row's (a call nobody has stamped yet, a client
 *    renamed since) — fire-and-forget, never from a half-answered lookup;
 *  - `npm run backfill:call-party-names -w backend/services/telephony` for the
 *    rows nobody has opened since (every imported Workiz call).
 *
 * `partyNames` is never read back into a response.
 */

/** Between the two sides' names. The box's text is folded to spaces, so it never holds one. */
export const PARTY_NAMES_SEPARATOR = '\n';

/** Shortest digit run treated as a number — "860" is an area code (callspage_wz_12_search_860). */
export const MIN_SEARCH_DIGITS = 3;

/** Longest text the box is matched with; more is a paste, not a search. */
export const MAX_SEARCH_LENGTH = 100;

/** Only digits and phone punctuation: "(469) 396-1234", "+1 469 396", "860". */
const PHONE_SHAPED = /^[\d\s().+\-–—]+$/;

/** What the box asks: folded text, and its digits when it reads as a phone. */
export interface CallTextSearch {
  text: string;
  digits?: string;
}

/** Lower case, accents folded, whitespace collapsed to single spaces, trimmed. */
export function foldSearchText(value: string | null | undefined): string {
  if (!value) return '';
  return String(value)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** The names a row is searched by: each folded, once, in order. */
export function partyNamesText(names: Array<string | undefined>): string {
  const out: string[] = [];
  for (const name of names) {
    const f = foldSearchText(name);
    if (f && !out.includes(f)) out.push(f);
  }
  return out.join(PARTY_NAMES_SEPARATOR);
}

/**
 * The box's text as the filter needs it, or undefined when nothing was typed.
 * `numbers: false` — a viewer without `contacts.view_numbers` — never matches
 * by digits: searching BY a number confirms whose it is (the jobs list and
 * crm's search-by-phone hold the same line).
 */
export function parseCallSearch(q: string | undefined, opts: { numbers: boolean }): CallTextSearch | undefined {
  const text = foldSearchText(q).slice(0, MAX_SEARCH_LENGTH).trim();
  if (!text) return undefined;
  if (!opts.numbers || !PHONE_SHAPED.test(text)) return { text };
  const digits = text.replace(/\D/g, '');
  return digits.length >= MIN_SEARCH_DIGITS ? { text, digits } : { text };
}

/** The FilterExpression fragment: one parenthesised OR, ANDed with the other filters. */
export function callSearchClause(
  search: CallTextSearch,
  names: Record<string, string>,
  values: Record<string, unknown>,
): string {
  names['#partyNames'] = 'partyNames';
  values[':qText'] = search.text;
  const legs = ['contains(#partyNames, :qText)'];
  if (search.digits) {
    names['#from'] = 'from';
    names['#to'] = 'to';
    values[':qDigits'] = search.digits;
    legs.push('contains(#from, :qDigits)', 'contains(#to, :qDigits)');
  }
  return `(${legs.join(' OR ')})`;
}
