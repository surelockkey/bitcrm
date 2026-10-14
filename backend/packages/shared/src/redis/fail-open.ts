/**
 * Run a cache operation and answer `fallback` if Redis fails.
 *
 * A cache is an optimisation, so losing it must never fail the request. In the
 * week of 7 Oct, crm and deal returned 1,095 × 500 because a cache `get` threw
 * "Connection is closed." while the outgoing task of a deploy was still
 * serving. A failed read is a miss; a failed write or invalidation is
 * forgotten, and the key's TTL bounds how stale it can get.
 */
export async function failOpen<T>(
  op: () => Promise<T>,
  fallback: T,
  onError?: (error: Error) => void,
): Promise<T> {
  try {
    return await op();
  } catch (error) {
    onError?.(error instanceof Error ? error : new Error(String(error)));
    return fallback;
  }
}
