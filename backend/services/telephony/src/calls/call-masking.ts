import { type EnrichedCall } from './party-resolver';

/**
 * A call as a masked viewer sees it: everything except the digits.
 *
 * `from`/`to` are the only fields that carry a client's real number, and they
 * are the ONLY thing removed. The resolved parties stay — a technician still
 * has to see that they spoke to Maria Alvarez, and the softphone screen-pop is
 * built entirely from the party, not the number. Stripping names as well would
 * make the feature unusable and push people back to their own handsets, which
 * is the outcome masking exists to prevent.
 */
export interface MaskedCallFields {
  /** Set when a number was present on that side and has been withheld. */
  fromMasked?: true;
  toMasked?: true;
}

export type MaybeMaskedCall = EnrichedCall & MaskedCallFields;

/**
 * Drop the numbers unless the viewer holds `contacts.view_numbers`.
 *
 * Always copies. Records reach here from `UserNamesService`/`ContactLookupService`
 * caches and, on the SSE path, from a single bus event fanned out to every
 * subscriber — masking in place would blank the numbers for an allowed viewer
 * sharing the same object.
 */
export function maskCall(call: EnrichedCall, allowed: boolean): MaybeMaskedCall;
export function maskCall(
  call: EnrichedCall | undefined,
  allowed: boolean,
): MaybeMaskedCall | undefined;
export function maskCall(
  call: EnrichedCall | undefined,
  allowed: boolean,
): MaybeMaskedCall | undefined {
  if (!call || allowed) return call;

  const masked: MaybeMaskedCall = { ...call, from: undefined, to: undefined };
  if (call.from) masked.fromMasked = true;
  if (call.to) masked.toMasked = true;
  return masked;
}

/** {@link maskCall} across a list. */
export function maskCalls(
  calls: EnrichedCall[],
  allowed: boolean,
): MaybeMaskedCall[] {
  if (allowed) return calls;
  return calls.map((c) => maskCall(c, false)!);
}
