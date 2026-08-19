import {
  parsePhoneNumberFromString,
  AsYouType,
  getCountries,
  getCountryCallingCode,
  type CountryCode,
} from "libphonenumber-js";

/**
 * The one place phone numbers are validated and formatted across the app. Every
 * input normalizes to E.164 for storage; display is national for the default
 * country (`(404) 555-1234` — no +1 anywhere on the site) and international
 * for everything else (`+380 95 860 1427`).
 *
 * Numbers typed without a country code are assumed to be from DEFAULT_COUNTRY;
 * a number typed with a leading `+` is parsed in its own country. This mirrors
 * the backend's E.164 normalization so the two never disagree.
 */
export const DEFAULT_COUNTRY: CountryCode = "US";
const DEFAULT_CALLING_CODE = getCountryCallingCode(DEFAULT_COUNTRY);

/** Normalize any input to E.164 (`+14045551234`) or null if it isn't a valid number. */
export function normalizePhone(input: string): string | null {
  if (!input?.trim()) return null;
  const parsed = parsePhoneNumberFromString(input, DEFAULT_COUNTRY);
  return parsed?.isValid() ? parsed.number : null;
}

/** True when the input is a valid, dialable phone number. */
export function isValidPhone(input: string): boolean {
  return normalizePhone(input) !== null;
}

/**
 * Canonical display: numbers from the default country render nationally —
 * `(404) 555-1234`, never `+1` — since this is a US product; anything foreign
 * keeps its code in international grouping, `+380 95 860 1427` (which, unlike
 * the national format, carries no trunk prefix to read like an extra digit).
 * Unparseable input passes through.
 */
export function formatPhone(input: string): string {
  if (!input) return input;
  const parsed = parsePhoneNumberFromString(input, DEFAULT_COUNTRY);
  if (!parsed) return input;
  return parsed.countryCallingCode === DEFAULT_CALLING_CODE
    ? parsed.formatNational()
    : parsed.formatInternational();
}

/** Live national formatting while typing in the given country's style. */
export function formatAsYouType(input: string, country: CountryCode = DEFAULT_COUNTRY): string {
  return new AsYouType(country).input(input);
}

/** The dial code for a country, e.g. `US` → `1`, `UA` → `380`. */
export function callingCode(country: CountryCode): string {
  return getCountryCallingCode(country);
}

/** The country a number belongs to, or the default when it can't be determined. */
export function countryOf(input: string): CountryCode {
  return parsePhoneNumberFromString(input, DEFAULT_COUNTRY)?.country ?? DEFAULT_COUNTRY;
}

/** The national significant digits of a number (no country code), for editing. */
export function nationalDigits(input: string): string {
  const parsed = parsePhoneNumberFromString(input, DEFAULT_COUNTRY);
  return parsed ? parsed.nationalNumber : input.replace(/\D/g, "");
}

/** Combine a country + national digits into E.164 (`+14045551234`), or "" if empty. */
export function toE164(country: CountryCode, national: string): string {
  const digits = national.replace(/\D/g, "");
  if (!digits) return "";
  return `+${getCountryCallingCode(country)}${digits}`;
}

/**
 * What typed or pasted text means as a national number of the selected country.
 * The country is a fixed input here, never inferred from the text — pastes like
 * `+1 (404) 555-1234`, `14045551234` or a trunk-prefixed `0958601427` all
 * reduce to their national digits, while a foreign `+code` is left as plain
 * digits rather than switching the country out from under the user.
 */
export function nationalInput(raw: string, country: CountryCode = DEFAULT_COUNTRY): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";

  // A complete, valid number in this country — however it was written (with
  // dial code, national/trunk prefix, or plain) — is its national digits.
  const parsed = parsePhoneNumberFromString(
    trimmed.startsWith("+") ? trimmed : digits,
    country,
  );
  if (parsed?.isValid() && parsed.countryCallingCode === getCountryCallingCode(country)) {
    return parsed.nationalNumber;
  }

  // Still incomplete: only an explicit `+<own dial code>` prefix is stripped.
  const cc = getCountryCallingCode(country);
  if (trimmed.startsWith("+") && digits.startsWith(cc)) return digits.slice(cc.length);
  return digits;
}

/** 🇺🇸 flag emoji for an ISO country code. */
export function flagEmoji(country: CountryCode): string {
  return country
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

const regionNames = typeof Intl !== "undefined" && "DisplayNames" in Intl
  ? new Intl.DisplayNames(["en"], { type: "region" })
  : null;

export interface PhoneCountry {
  country: CountryCode;
  name: string;
  callingCode: string;
  flag: string;
}

// A few common countries floated to the top; the rest follow alphabetically.
const PINNED: CountryCode[] = ["US", "CA", "GB", "AU", "MX"];

/** All selectable countries with flag, name and dial code (pinned favorites first). */
export function phoneCountries(): PhoneCountry[] {
  const all = getCountries().map((country) => ({
    country,
    name: regionNames?.of(country) ?? country,
    callingCode: getCountryCallingCode(country),
    flag: flagEmoji(country),
  }));
  const pinned = PINNED.map((c) => all.find((x) => x.country === c)).filter(Boolean) as PhoneCountry[];
  const rest = all
    .filter((x) => !PINNED.includes(x.country))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...pinned, ...rest];
}
