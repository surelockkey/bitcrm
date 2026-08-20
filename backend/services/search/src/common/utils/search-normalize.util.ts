/** Characters a phone number may contain besides digits (separators, +, dashes). */
const PHONE_CHARS = /^[\d\s().+\-–—]+$/;

/**
 * True when the string reads as a phone number: only digits and phone
 * punctuation, with at least 7 digits (shorter runs are zips, job numbers…).
 */
export function looksLikePhone(value: string | undefined | null): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed || !PHONE_CHARS.test(trimmed)) return false;
  return trimmed.replace(/\D/g, '').length >= 7;
}

/** Shortest phone fragment worth matching — 3-digit runs are too noisy. */
const MIN_PHONE_FRAGMENT = 4;

/**
 * Digit-string variants a phone is indexed under, so any way a user types it —
 * "(728) 347-8370", "7283478370", "+1 728 347 8370", or just a fragment —
 * collapses to a match. NANP numbers get both the 10-digit local and the
 * 1-prefixed form; every suffix of 4+ digits is indexed too, which together
 * with the index's edge-ngrams makes every 4+ digit substring matchable.
 * Lenient: indexing must never fail on malformed data, so bad input just
 * yields no variants.
 */
export function phoneSearchVariants(phone: string | undefined | null): string[] {
  if (!phone) return [];
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return [];
  const variants = new Set([digits]);
  let local = digits;
  if (digits.length === 10) variants.add(`1${digits}`);
  if (digits.length === 11 && digits.startsWith('1')) {
    local = digits.slice(1);
    variants.add(local);
  }
  for (let start = 1; start <= local.length - MIN_PHONE_FRAGMENT; start++) {
    variants.add(local.slice(start));
  }
  return [...variants];
}

/**
 * Query-side twin of `phoneSearchVariants`: when the whole query reads as a
 * phone number (or a fragment of one — 4+ digits), returns its collapsed
 * digit string to match the indexed variants; returns undefined for anything
 * else so text search is untouched.
 */
export function phoneQueryDigits(query: string): string | undefined {
  const trimmed = query.trim();
  if (!trimmed || !PHONE_CHARS.test(trimmed)) return undefined;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= MIN_PHONE_FRAGMENT ? digits : undefined;
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
