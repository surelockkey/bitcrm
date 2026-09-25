import { createHash } from 'crypto';
import { type CountRowsResult } from './count-rows';

/**
 * A short-lived cache in front of a list count.
 *
 * `countRows` walks an index to answer "how many", and a page load is a bad
 * place to pay that twice. The number also ages well: a list gains a row here
 * and there, and "Page 2 of 7" does not become wrong the moment it does. Half
 * a minute of staleness buys every tab flip and filter change after the first.
 *
 * The count is a nice-to-have and this treats it as one. The panel renders
 * without a total — it simply stops printing "of 7" — so a Redis that is down,
 * or a value left by an older shape of this code, costs the number and not the
 * page. Every path through here either returns a count or falls back to taking
 * one; none of them throws.
 */

/** The slice of ioredis this needs, so a test can hand it a Map. */
export interface CountCacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
}

export async function cachedCount(
  redis: CountCacheClient,
  key: string,
  ttlSeconds: number,
  count: () => Promise<CountRowsResult>,
): Promise<CountRowsResult> {
  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as CountRowsResult;
  } catch {
    // Unreachable, or unparseable. Either way the answer is to go and count.
  }

  const fresh = await count();

  try {
    await redis.set(key, JSON.stringify(fresh), 'EX', ttlSeconds);
  } catch {
    // The count stands even when it cannot be kept.
  }

  return fresh;
}

/**
 * The cache key of one list under one set of filters.
 *
 * The filters belong in the key: "how many products" and "how many products in
 * this category" are different questions, and one key would serve one of them
 * the other's answer. Key order must not matter — the same filters built in a
 * different order are the same question — and neither must an explicitly
 * undefined filter, which is how a DTO spells "not set".
 */
export function countCacheKey(list: string, filters: Record<string, unknown>): string {
  const stable = Object.entries(filters)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const digest = createHash('sha1').update(JSON.stringify(stable)).digest('hex');
  return `list-count:${list}:${digest}`;
}
