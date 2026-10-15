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
  /** Keyed BY THE NUMBER — which is why a masked viewer never gets it. */
  phoneExtensions?: Record<string, string>;
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
  /**
   * The extensions, by position — `[i]` is what to press on hidden number
   * `i` ('' for none). Sent instead of `phoneExtensions`, whose KEYS are the
   * numbers, and only when at least one number has an extension.
   */
  phoneExtensionsByIndex?: string[];
};

/**
 * Empty the numbers, keep the count. Returns the input unchanged when the
 * viewer holds the grant, so the allowed path costs nothing.
 *
 * `phoneExtensions` goes too: it is keyed by the number, so keeping it would
 * hand the viewer every number that has an extension. What they get instead
 * is the same extensions by position, aligned with the hidden rows, so the UI
 * can still show "ext 102" on the right one.
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
  const { phoneExtensions, ...rest } = record;
  const byIndex = phones.map((phone) => phoneExtensions?.[phone] ?? '');
  return {
    ...(rest as T),
    phones: [],
    phoneCount: phones.length,
    phonesMasked: true,
    ...(byIndex.some(Boolean) && { phoneExtensionsByIndex: byIndex }),
  };
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
  if (allowed || !('phones' in dto || 'phoneExtensions' in dto)) return dto;
  // The extensions go with the numbers: a masked viewer never saw the
  // number-keyed map, so what they send back is `{}` — which the service would
  // re-key against the numbers on file and wipe every extension.
  const {
    phones: _dropped,
    phoneExtensions: _droppedExtensions,
    ...rest
  } = dto as T & { phones?: string[]; phoneExtensions?: unknown };
  return rest as unknown as T;
}
