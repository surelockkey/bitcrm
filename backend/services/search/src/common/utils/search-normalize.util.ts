/**
 * Lenient phone → search token. Unlike crm's `normalizePhone` (which throws on
 * bad input), indexing must never fail on malformed data, so this just reduces to
 * a digit string prefixed with the country code when we can infer one. Returns
 * undefined for empty/garbage so callers can filter it out.
 */
export function phoneSearchKey(phone: string | undefined | null): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return undefined;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

/** Drops falsy/blank entries and de-duplicates while preserving order. */
export function compactUnique(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    const trimmed = String(v).trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
