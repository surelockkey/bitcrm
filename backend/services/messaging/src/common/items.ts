const KEY_ATTRIBUTE = /^(PK|SK|GSI\dPK|GSI\dSK)$/;

/** Entity view of a stored item: key and index attributes (and `extra`) removed. */
export function stripKeys<T>(item: Record<string, unknown>, extra: readonly string[] = []): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    if (KEY_ATTRIBUTE.test(key) || extra.includes(key)) continue;
    out[key] = value;
  }
  return out as T;
}

/**
 * Drops `undefined` and empty-string attributes before a Put (design §3.5:
 * empty strings are never written; the document client already drops
 * `undefined`, this makes the item shape explicit and testable).
 */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === '') continue;
    out[key] = value;
  }
  return out as Partial<T>;
}

/** ISO timestamp → epoch seconds, the unit DynamoDB TTL expects. */
export const epochSeconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
