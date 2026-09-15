/**
 * SMS segment arithmetic, the way Twilio bills it.
 *
 * A body made only of GSM-7 characters fits 160 septets in one segment and
 * 153 per segment once it splits (the rest is the concatenation header).
 * Anything else — an emoji, a Cyrillic letter, a curly quote — flips the
 * whole message to UCS-2: 70 code units alone, 67 per segment concatenated.
 * The counter under the composer shows the user which side they are on
 * before the message costs three segments instead of one.
 */

export type SmsEncoding = "GSM-7" | "UCS-2";

export interface SegmentInfo {
  encoding: SmsEncoding;
  /** Septets (GSM-7) or UTF-16 code units (UCS-2) — what the limits count. */
  units: number;
  segments: number;
  /** Units one segment holds at this encoding and segment count. */
  perSegment: number;
  /** Units left before the next segment starts. */
  remaining: number;
}

const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
/** Costs two septets: escape + character. */
const GSM7_EXTENDED = "\f^{}\\[~]|€";

const GSM7_SINGLE = 160;
const GSM7_MULTI = 153;
const UCS2_SINGLE = 70;
const UCS2_MULTI = 67;

const basicSet = new Set(GSM7_BASIC);
const extendedSet = new Set(GSM7_EXTENDED);

/** True when every character has a GSM-7 encoding. */
export function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!basicSet.has(ch) && !extendedSet.has(ch)) return false;
  }
  return true;
}

function gsm7Septets(text: string): number {
  let n = 0;
  for (const ch of text) n += extendedSet.has(ch) ? 2 : 1;
  return n;
}

export function countSegments(text: string): SegmentInfo {
  if (isGsm7(text)) {
    const units = gsm7Septets(text);
    return build("GSM-7", units, GSM7_SINGLE, GSM7_MULTI);
  }
  // UTF-16 length counts surrogate pairs twice, as UCS-2 does.
  return build("UCS-2", text.length, UCS2_SINGLE, UCS2_MULTI);
}

function build(
  encoding: SmsEncoding,
  units: number,
  single: number,
  multi: number,
): SegmentInfo {
  if (units === 0) {
    return { encoding, units, segments: 0, perSegment: single, remaining: single };
  }
  if (units <= single) {
    return { encoding, units, segments: 1, perSegment: single, remaining: single - units };
  }
  const segments = Math.ceil(units / multi);
  return {
    encoding,
    units,
    segments,
    perSegment: multi,
    remaining: segments * multi - units,
  };
}
