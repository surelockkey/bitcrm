/**
 * Widen a `from`/`to` filter into the ISO instants a sort key is built from.
 *
 * The app sends plain dates ("2026-09-17"); the web and any report may send
 * full instants. A bare date is taken as the whole UTC day — rows are stamped
 * in UTC, and inventing a per-account timezone at the query layer would make
 * this boundary disagree with every other date in the system.
 *
 * Shared by the timesheet and the location track, which page the same way.
 */
export function toRangeStart(from: string): string {
  return from.length === 10 ? `${from}T00:00:00.000Z` : from;
}

export function toRangeEnd(to: string): string {
  return to.length === 10 ? `${to}T23:59:59.999Z` : to;
}
