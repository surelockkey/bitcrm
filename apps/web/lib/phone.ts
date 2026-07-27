import {
  parsePhoneNumberFromString,
  AsYouType,
  getCountries,
  getCountryCallingCode,
  type CountryCode,
} from "libphonenumber-js";

/**
 * The one place phone numbers are validated and formatted across the app. Every
 * input normalizes to E.164 for storage and every display renders the same
 * international format (with country code), e.g. `+1 404 555 1234`.
 *
 * Numbers typed without a country code are assumed to be from DEFAULT_COUNTRY;
 * a number typed with a leading `+` is parsed in its own country. This mirrors
 * the backend's E.164 normalization so the two never disagree.
 */
export const DEFAULT_COUNTRY: CountryCode = "US";

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
 * Canonical display: the country dial code followed by the national format, e.g.
 * `+1 (404) 555-1234`. Keeps the familiar national grouping while still showing
 * which country the number belongs to. Unparseable input passes through.
 */
export function formatPhone(input: string): string {
  if (!input) return input;
  const parsed = parsePhoneNumberFromString(input, DEFAULT_COUNTRY);
  return parsed ? `+${parsed.countryCallingCode} ${parsed.formatNational()}` : input;
}

/** Live national formatting while typing in the given country's style. */
export function formatAsYouType(input: string, country: CountryCode = DEFAULT_COUNTRY): string {
  return new AsYouType(country).input(input);
}

/** The dial code for a country, e.g. `US` → `1`, `UA` → `380`. */
export function callingCode(country: CountryCode): string {
  return getCountryCallingCode(country);
}

/**
 * Single-field international formatting: any E.164-ish input → `+380 95 860 1427`
 * (country code + grouped national), formatting incrementally so it works while
 * typing. Empty input stays empty.
 */
export function formatIntl(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (!digits) return "";
  return new AsYouType().input(`+${digits}`);
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
 * When a raw input carries its own country code (starts with `+`), detect the
 * country and split off the national part — so typing/pasting `+44 20 7946 0000`
 * flips the selector to 🇬🇧 and reformats the number. Returns null for plain
 * national input (no `+`).
 */
export function detectInternational(
  raw: string,
): { country: CountryCode; national: string } | null {
  if (!raw.trim().startsWith("+")) return null;

  const parsed = parsePhoneNumberFromString(raw);
  if (parsed?.country) {
    return { country: parsed.country, national: formatAsYouType(parsed.nationalNumber, parsed.country) };
  }

  // Still incomplete — let AsYouType infer the country from the digits so far.
  const ayt = new AsYouType();
  ayt.input(raw);
  const country = ayt.getCountry();
  if (country) {
    const cc = getCountryCallingCode(country);
    const digits = raw.replace(/\D/g, "");
    const national = digits.startsWith(cc) ? digits.slice(cc.length) : digits;
    return { country, national: formatAsYouType(national, country) };
  }
  return null;
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
