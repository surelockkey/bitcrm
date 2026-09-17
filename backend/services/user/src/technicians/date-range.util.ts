/**
 * Widen a `from`/`to` filter into the ISO instants a sort key is built from.
 *
 * The app sends plain dates ("2026-09-17"); the web and any report may send
 * full instants. A bare date is taken as the whole UTC day — rows are stamped
 * in UTC, and inventing a per-account timezone at the query layer would make
 * this boundary disagree with every other date in the system.
 *
 * Anything else is re-stamped through Date rather than used verbatim, because
 * these strings become DynamoDB key bounds and the query is a *lexical*
 * BETWEEN. Stored instants are `Date.toISOString()` — always UTC, always
 * milliseconds — so the same instant written in another dialect does not
 * compare where it belongs. "2026-09-17T00:00:00-04:00" (what a report for a
 * US-Eastern payroll week sends) reads as a bound four hours out AND sorts
 * against `.000Z` rows on the '-' vs '.' character: it silently drags in the
 * previous evening's shift and drops the current one. Normalising makes the
 * bound the same dialect as the rows it is compared against.
 *
 * Shared by the timesheet and the location track, which page the same way.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

export function toRangeStart(from: string): string {
  return DATE_ONLY.test(from) ? `${from}T00:00:00.000Z` : toUtcInstant(from);
}

export function toRangeEnd(to: string): string {
  return DATE_ONLY.test(to) ? `${to}T23:59:59.999Z` : toUtcInstant(to);
}

/**
 * A zone-less date-time ("2026-09-17T09:00:00") is read as UTC, not as the
 * server's local time: every stored stamp is UTC, and a bound that moved with
 * the host's TZ would make the same query answer differently on two machines.
 *
 * An unparseable string is handed back untouched — validation already rejected
 * it, and a silent `new Date(NaN)` would turn a bad range into a wrong one
 * rather than an error.
 */
function toUtcInstant(value: string): string {
  const zoned = HAS_ZONE.test(value) ? value : `${value}Z`;
  const ms = Date.parse(zoned);
  return Number.isNaN(ms) ? value : new Date(ms).toISOString();
}
