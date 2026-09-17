import type { Query } from '@tanstack/react-query';

/**
 * What survives a restart.
 *
 * This is the offline store: the technician opens the app in a basement and the
 * day's list, the jobs on it and their own profile are already there
 * (docs/ARCHITECTURE.md §2.3). Everything else is re-fetched — a presigned
 * download URL written to disk would be expired before it was ever read, and a
 * failed query re-run is cheaper than a failure remembered.
 *
 * Kept as a pure predicate so the rule is a test rather than a guess.
 */
export function shouldPersistQuery(query: {
  queryKey: readonly unknown[];
  state: { status: string };
}): boolean {
  if (query.state.status !== 'success') return false;

  const [root, scope] = query.queryKey;
  if (root === 'me') return true;
  if (root === 'deals') return scope === 'list' || scope === 'detail';
  // What the office said is worth as much underground as the job it was about:
  // "the gate code is 4021" cannot be re-read over a connection that is not
  // there. The badge counter is deliberately not kept — a restored unread
  // count with nothing behind it is a number that lies.
  if (root === 'messaging') return scope === 'team-thread' || scope === 'messages';
  // The van and its contents. Its whole question — "have I got one on board?"
  // — gets asked in the places with the worst signal there are: a basement, an
  // underground car park, the back of a building. Quantities drift while the
  // phone is offline, so the screen says when what it shows came off the disk.
  if (root === 'inventory') return scope === 'containers';
  // "Am I already on the clock?" — the one question in this app whose wrong
  // answer costs somebody money. A phone that forgets it over a restart with no
  // signal shows "Not on the clock" and offers "Clock in" to a technician who
  // clocked in at seven; that tap is a second entry on the same shift. Only the
  // running entry is kept — a week of rows is a report, and a report read off
  // the disk as if it were this week's hours is a number nobody can account for.
  if (root === 'timeclock') return scope === 'current';
  return false;
}

/** The shape `persistQueryClient` expects. */
export const persistFilter = (query: Query): boolean =>
  shouldPersistQuery(query as unknown as Parameters<typeof shouldPersistQuery>[0]);

/**
 * How stale a restored cache may be before it is thrown away instead. A week
 * covers a holiday; beyond that, yesterday's route is noise.
 */
export const MAX_PERSISTED_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Bumped whenever a cached shape changes, so old blobs are discarded. */
export const PERSISTED_CACHE_BUSTER = 'v1';

/** AsyncStorage key the whole cache blob lives under. */
export const PERSISTED_CACHE_KEY = 'bitcrm.query-cache';
