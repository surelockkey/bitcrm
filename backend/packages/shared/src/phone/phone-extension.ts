import { tryNormalizePhone } from './normalize-phone';

/**
 * How many characters an extension may keep. Long enough for the longest real
 * PBX extension plus a pause or two, short enough that the field can't quietly
 * become a notes box.
 */
export const MAX_EXTENSION_LENGTH = 10;

/** Everything that isn't a key you can press once the call connects. */
const NOT_DIALABLE = /[^0-9*#,]/g;

/**
 * An extension is what somebody presses after the call is answered, so it
 * reduces to dial keys: digits, `*`, `#`, and `,` for a pause. The wrappers
 * people type around it — `ext.`, `x`, `press` — carry no dial meaning and are
 * dropped, which also means a note like "ask for dispatch" normalizes to
 * nothing rather than being stored as an undialable extension.
 */
export function normalizeExtension(raw: string | undefined | null): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(NOT_DIALABLE, '').slice(0, MAX_EXTENSION_LENGTH);
}

/**
 * Extensions belong to a specific number, so they are stored keyed by it. The
 * keys arrive as typed and have to land on the same E.164 form the phone list
 * was normalized to, or a number and its extension would never be read back
 * together.
 *
 * An entry whose number isn't on the record is dropped: without that, an
 * extension would outlive the number it belongs to and reattach itself the
 * next time that number came back.
 *
 * Keys are matched against the already-normalized `phones`, falling back to
 * the raw key — company main lines keep entries libphonenumber can't parse.
 */
export function normalizePhoneExtensions(
  extensions: Record<string, string> | undefined | null,
  phones: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!extensions || typeof extensions !== 'object') return out;

  const allowed = new Set(phones);
  for (const [key, value] of Object.entries(extensions)) {
    const phone = [tryNormalizePhone(key), key].find(
      (candidate): candidate is string => !!candidate && allowed.has(candidate),
    );
    if (!phone) continue;

    const extension = normalizeExtension(value);
    if (extension) out[phone] = extension;
  }
  return out;
}
