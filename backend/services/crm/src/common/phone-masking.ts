/**
 * Client phone numbers are the one field on a contact or company that the
 * `contacts.view_numbers` grant governs. Call masking is the absence of that
 * grant, so a masked viewer gets the whole record minus the numbers.
 *
 * Two halves, and shipping only the first is worse than shipping neither:
 *
 *  - {@link maskPhones} on the way out, so the numbers never reach the browser.
 *  - {@link stripUnwritablePhones} on the way back in, because this service has
 *    no whitelisting `ValidationPipe` (verified: crm/src/main.ts sets a global
 *    filter and prefix, but no global pipe). A masked edit form loads
 *    `phones: []` and submits it back unchanged, and `if (dto.phones)` is true
 *    for an empty array — so redaction alone silently deletes every number on
 *    the record the first time a masked user saves an unrelated field.
 *
 * Internal service-to-service endpoints are deliberately NOT masked: the
 * masking machinery itself resolves the real number server-side to place the
 * call. Redaction belongs on the user-facing routes only.
 */

/** Anything with a phones array — Contact and Company both qualify. */
export interface PhoneBearing {
  phones?: string[];
}

/**
 * What a masked viewer sees instead of the numbers. Both extras are optional in
 * the type because an allowed viewer's record carries neither — callers render
 * "hidden" off `phonesMasked` and never have to narrow a union.
 */
export type MaybeMasked<T> = T & {
  /** How many numbers exist, so the UI can say "2 numbers, hidden". */
  phoneCount?: number;
  phonesMasked?: true;
};

/**
 * Empty the numbers, keep the count. Returns the input unchanged when the
 * viewer holds the grant, so the allowed path costs nothing.
 *
 * Always copies rather than mutating: records come out of ContactsCacheService,
 * which hands the same object to concurrent requests — masking in place would
 * blank the numbers for an allowed viewer served from the same cache entry.
 */
export function maskPhones<T extends PhoneBearing>(
  record: T,
  allowed: boolean,
): MaybeMasked<T> {
  if (allowed) return record;
  const phones = record.phones ?? [];
  return { ...record, phones: [], phoneCount: phones.length, phonesMasked: true };
}

/** {@link maskPhones} across a list. */
export function maskPhonesEach<T extends PhoneBearing>(
  records: T[],
  allowed: boolean,
): Array<MaybeMasked<T>> {
  if (allowed) return records;
  return records.map((r) => maskPhones(r, false));
}

/**
 * Remove `phones` from a write payload the caller is not allowed to see.
 *
 * Dropped rather than rejected on purpose: a masked user editing a job note has
 * not tried to do anything wrong, and a 403 on every save would read as a bug.
 * They never saw the current value, so they cannot have meant to replace it —
 * and the field simply does not participate in their edit.
 */
export function stripUnwritablePhones<T extends object>(
  dto: T,
  allowed: boolean,
): T {
  if (allowed || !('phones' in dto)) return dto;
  const { phones: _dropped, ...rest } = dto as T & { phones?: string[] };
  return rest as unknown as T;
}
