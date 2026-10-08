import { BadRequestException } from '@nestjs/common';
import { type ListCallsFilter } from './calls.repository';
import { parseCallSearch } from './call-search';

/**
 * The query string of `GET /calls`, `/calls/count`, `/calls/stats/summary`
 * and `/calls/export.csv` — one set of filters, so the rows, "of N", the
 * cards and the file always describe the same calls. Query DTOs are not
 * transformed in this service; every value arrives as a string.
 */
export interface CallsQueryParams {
  cursor?: string;
  limit?: string;
  /** `inbound` | `outbound`, or both comma-separated. */
  direction?: string;
  /** Raw statuses and/or `answered`, `missed`, `active`, `voicemail`; comma list. */
  status?: string;
  /** User ids, comma list. */
  agentId?: string;
  /** Substring of either side's number. */
  number?: string;
  /** A client's numbers, comma list — matches any, either side. */
  numbers?: string;
  dateFrom?: string;
  dateTo?: string;
  origin?: string;
  /** Call-tag ids, comma list — any of them. */
  tagId?: string;
  /** Call-flow ids, comma list. */
  flowId?: string;
  /** Job-source (Workiz ad group) ids, comma list. */
  sourceId?: string;
  /** Whole seconds of talk time, inclusive. */
  minDuration?: string;
  maxDuration?: string;
  /** `true` | `false` (also 1/0, yes/no). */
  masked?: string;
  hasJob?: string;
  /** The Search box: a party's name, or digits of either number. */
  q?: string;
}

/** Each number adds two contains() to the filter — a phone list is capped. */
const MAX_NUMBERS = 20;

const text = (v: string | undefined): string | undefined => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t || undefined;
};

function seconds(name: string, v: string | undefined): number | undefined {
  const t = text(v);
  if (t === undefined) return undefined;
  if (!/^\d+$/.test(t)) throw new BadRequestException(`${name} is whole seconds`);
  return Number(t);
}

function yesNo(name: string, v: string | undefined): boolean | undefined {
  const t = text(v)?.toLowerCase();
  if (t === undefined) return undefined;
  if (t === 'true' || t === '1' || t === 'yes') return true;
  if (t === 'false' || t === '0' || t === 'no') return false;
  throw new BadRequestException(`${name} is true or false`);
}

/**
 * The repository filter for a query string. Comma lists stay as the wire
 * spelled them (`listOf` in call-filter-expression.ts splits them, and one
 * value keeps its old expression); a phone list is split here because the
 * repository has always taken it as an array.
 *
 * `opts.numbers` is the viewer's `contacts.view_numbers`: the Search box
 * (`q`) matches by digits only for a viewer who may see numbers.
 */
export function callsFilterFromQuery(
  query: CallsQueryParams,
  opts: { numbers: boolean },
): ListCallsFilter {
  const numbers = text(query.numbers)
    ?.split(',')
    .map((n) => n.trim())
    .filter(Boolean)
    .slice(0, MAX_NUMBERS);

  const filter: ListCallsFilter = {
    direction: text(query.direction),
    status: text(query.status),
    agentId: text(query.agentId),
    number: text(query.number),
    numbers: numbers?.length ? numbers : undefined,
    dateFrom: text(query.dateFrom),
    dateTo: text(query.dateTo),
    origin: text(query.origin),
    tagId: text(query.tagId),
    flowId: text(query.flowId),
    sourceId: text(query.sourceId),
    minDuration: seconds('minDuration', query.minDuration),
    maxDuration: seconds('maxDuration', query.maxDuration),
    masked: yesNo('masked', query.masked),
    hasJob: yesNo('hasJob', query.hasJob),
    search: parseCallSearch(query.q, opts),
  };
  // Undefined keys out: the count cache keys on the filter, and the tests
  // compare it whole.
  for (const key of Object.keys(filter) as (keyof ListCallsFilter)[]) {
    if (filter[key] === undefined) delete filter[key];
  }
  return filter;
}
