/**
 * The jobs list's Search box (`GET /deals?q=`), the Workiz way: a
 * case-insensitive piece of the client's name, the Job ID, phone digits typed
 * any way, the address, the job type, the job name, the email or the client's
 * company — never the technician, never the tags (jobslist notes, probed live
 * 2026-10-08).
 *
 * DynamoDB compares bytes, so what the box can find is kept on the job's
 * METADATA row already folded (lower case, accents off, one space), in two
 * halves with one writer each:
 *
 *   searchText / searchDigits              the job's own fields — written by the
 *                                          repository on create and on every
 *                                          update that touches an input
 *   clientSearchText / clientSearchDigits  the client record's (crm owns it) —
 *                                          written on create, on a client change,
 *                                          a merge and on `contact.updated`
 *
 * Fields are kept apart by a newline, which the box can never send (its text
 * is folded to single spaces), so no match runs from one field into the next.
 * Digits are their own attributes: "(469) 396" is the text "(469) 396" AND the
 * digits "469396", and only the second finds "+14693961234".
 *
 * The job type is deliberately NOT copied: its name is matched against the
 * catalog when the query arrives (`jobTypeIds`), so renaming a type never
 * leaves rows to restamp.
 *
 * None of these attributes is read back into `Deal` (`toDeal` is a
 * whitelist): the client's numbers must not reach a response through them.
 */

/** Between two fields of one half. The box's text is folded to spaces, so it never holds one. */
export const SEARCH_FIELD_SEPARATOR = '\n';

/** Shortest phone fragment worth matching — 3-digit runs are zips and street numbers (search-service's rule). */
export const MIN_PHONE_DIGITS = 4;

/** Longest text the box is matched with; more is a paste, not a search. */
export const MAX_SEARCH_LENGTH = 100;

/** Only digits and phone punctuation: "(469) 396-1234", "+1 469 396", "8179". */
const PHONE_SHAPED = /^[\d\s().+\-–—]+$/;

/** The deal attributes the job's own half is computed from — a write of any of them restamps it. */
export const DEAL_SEARCH_INPUTS: ReadonlySet<string> = new Set([
  'dealNumber',
  'jobName',
  'clientName',
  'address',
  'emailAddress',
  'clientCompanyName',
  'primaryPhone',
  'secondaryPhone',
  'phones',
]);

export interface DealSearchAttributes {
  searchText: string;
  searchDigits: string;
}

export interface ClientSearchAttributes {
  clientSearchText: string;
  clientSearchDigits: string;
}

/** What the box asks: folded text, its digits when it reads as a phone, and the job types its text names. */
export interface DealTextSearch {
  text: string;
  digits?: string;
  /** Catalog job types whose name contains `text` — resolved by the service, not stored on rows. */
  jobTypeIds?: string[];
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

const str = (v: unknown): string | undefined => (typeof v === 'string' || typeof v === 'number' ? String(v) : undefined);

/** Distinct, non-empty, folded — in first-seen order. */
function fields(values: Array<string | undefined>): string[] {
  const out: string[] = [];
  for (const v of values) {
    const f = foldSearchText(v);
    if (f && !out.includes(f)) out.push(f);
  }
  return out;
}

/** Each number as bare digits, once; fragments too short to be a number are dropped. */
function digitsOf(values: unknown[]): string {
  const out: string[] = [];
  for (const v of values) {
    const d = (str(v) ?? '').replace(/\D/g, '');
    if (d.length >= MIN_PHONE_DIGITS && !out.includes(d)) out.push(d);
  }
  return out.join(SEARCH_FIELD_SEPARATOR);
}

function fullName(name: unknown): string | undefined {
  if (!name || typeof name !== 'object') return undefined;
  const n = name as { firstName?: unknown; lastName?: unknown };
  return [str(n.firstName), str(n.lastName)].filter(Boolean).join(' ');
}

/** The job's own half, from a METADATA row (or a `Deal` plus the importer's extra attributes). */
export function dealSearchAttributes(row: Record<string, unknown>): DealSearchAttributes {
  const address = (row.address && typeof row.address === 'object' ? row.address : {}) as Record<string, unknown>;
  const code = str(row.dealNumber);
  const text = fields([
    code ? `#${code}` : undefined,
    str(row.jobName),
    fullName(row.clientName),
    str(address.street),
    str(address.city),
    str(address.state),
    str(address.zip),
    str(row.emailAddress),
    str(row.clientCompanyName),
  ]);
  const phones = Array.isArray(row.phones) ? row.phones : [];
  return {
    searchText: text.join(SEARCH_FIELD_SEPARATOR),
    searchDigits: digitsOf([row.primaryPhone, row.secondaryPhone, ...phones]),
  };
}

/** The client record's half: the full name, every email, the company; the numbers as digits. */
export function clientSearchAttributes(
  contact: { firstName?: string; lastName?: string; phones?: string[]; emails?: string[] },
  companyTitle?: string,
): ClientSearchAttributes {
  return {
    clientSearchText: fields([fullName(contact), ...(contact.emails ?? []), companyTitle]).join(SEARCH_FIELD_SEPARATOR),
    clientSearchDigits: digitsOf(contact.phones ?? []),
  };
}

/**
 * The box's text as the filter needs it, or undefined when nothing was typed.
 * `numbers: false` — a caller without `contacts.view_numbers` — never matches
 * by digits: searching BY a number confirms whose it is, the same reason crm
 * guards `GET /contacts/search/by-phone` with that grant.
 */
export function parseTextSearch(q: string | undefined, opts: { numbers: boolean }): DealTextSearch | undefined {
  const text = foldSearchText(q).slice(0, MAX_SEARCH_LENGTH).trim();
  if (!text) return undefined;
  if (!opts.numbers || !PHONE_SHAPED.test(text)) return { text };
  const digits = text.replace(/\D/g, '');
  return digits.length >= MIN_PHONE_DIGITS ? { text, digits } : { text };
}

const has = (value: unknown, needle: string) => typeof value === 'string' && value.includes(needle);

/** The in-memory twin of `textSearchExpression`, for reads whose filter cannot run in DynamoDB. */
export function matchesTextSearch(row: Record<string, unknown>, search: DealTextSearch): boolean {
  if (has(row.searchText, search.text) || has(row.clientSearchText, search.text)) return true;
  if (search.digits && (has(row.searchDigits, search.digits) || has(row.clientSearchDigits, search.digits))) return true;
  return Boolean(search.jobTypeIds?.length && search.jobTypeIds.includes(row.jobTypeId as string));
}

/** DynamoDB's IN takes at most 100 operands. */
const IN_MAX = 100;

/** The FilterExpression fragment: one parenthesised OR, ANDed with the list's other filters. */
export function textSearchExpression(search: DealTextSearch): {
  expression: string;
  names: Record<string, string>;
  values: Record<string, unknown>;
} {
  const names: Record<string, string> = { '#searchText': 'searchText', '#clientSearchText': 'clientSearchText' };
  const values: Record<string, unknown> = { ':qText': search.text };
  const legs = ['contains(#searchText, :qText)', 'contains(#clientSearchText, :qText)'];
  if (search.digits) {
    names['#searchDigits'] = 'searchDigits';
    names['#clientSearchDigits'] = 'clientSearchDigits';
    values[':qDigits'] = search.digits;
    legs.push('contains(#searchDigits, :qDigits)', 'contains(#clientSearchDigits, :qDigits)');
  }
  const types = search.jobTypeIds ?? [];
  if (types.length) {
    names['#jobTypeId'] = 'jobTypeId';
    for (let i = 0; i < types.length; i += IN_MAX) {
      const list = types.slice(i, i + IN_MAX).map((id, j) => {
        values[`:qType${i + j}`] = id;
        return `:qType${i + j}`;
      });
      legs.push(`#jobTypeId IN (${list.join(', ')})`);
    }
  }
  return { expression: `(${legs.join(' OR ')})`, names, values };
}
