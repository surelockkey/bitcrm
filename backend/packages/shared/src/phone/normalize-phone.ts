import { BadRequestException } from '@nestjs/common';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** Numbers typed without a country code are assumed to be from here. */
const DEFAULT_COUNTRY = 'US';

/**
 * A dialable number → E.164, the one form every service stores and matches on.
 *
 * This has to agree byte-for-byte across services: telephony matches a call's
 * endpoint against both CRM contacts and system users, so a number normalized
 * one way here and another way there simply never matches. That is why it
 * lives in shared rather than being reimplemented per service.
 *
 * libphonenumber does the real work — crucially it strips national trunk
 * prefixes, so `+380 095 860 1427` becomes `+380958601427` and matches what
 * the carrier actually reports. A hand-rolled digits-only rule kept that `0`
 * and silently never matched.
 *
 * Input it can't validate falls back to the older digits rule rather than
 * throwing: real records already exist under that scheme, and refusing to
 * save an unrelated edit to a contact because their phone predates this
 * would be worse than storing it as-is.
 */
export function normalizePhone(phone: string): string {
  const parsed = parsePhoneNumberFromString(phone, DEFAULT_COUNTRY);
  if (parsed?.isValid()) return parsed.number;
  return legacyNormalize(phone);
}

/** The pre-libphonenumber rule, kept for input libphonenumber rejects. */
function legacyNormalize(phone: string): string {
  const digits = phone.replace(/\D/g, '');

  if (digits.length < 10) {
    throw new BadRequestException(`Invalid phone number: ${phone}`);
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length <= 15) return `+${digits}`;

  throw new BadRequestException(`Invalid phone number: ${phone}`);
}

export function normalizePhones(phones: string[]): string[] {
  return phones.map(normalizePhone);
}

/** Like {@link normalizePhone} but for untrusted input: never throws. */
export function tryNormalizePhone(phone: string): string | null {
  try {
    return normalizePhone(phone);
  } catch {
    return null;
  }
}

/**
 * Every form a stored number might already be under, for look-ups that must
 * find records written before normalization was fixed. The canonical form
 * comes first. Callers dedupe; order matters only for which wins a tie.
 */
export function phoneMatchVariants(phone: string): string[] {
  // Nothing dialable in it at all — `client:<uuid>` legs land here, and
  // libphonenumber will happily read stray digits out of one.
  const canonical = tryNormalizePhone(phone);
  if (!canonical) return [];

  const variants = new Set<string>([canonical]);

  try {
    variants.add(legacyNormalize(phone));
  } catch {
    // Canonical only.
  }

  // Records stored with the trunk prefix still in place, e.g. +380[0]95…
  // Only meaningful for a number libphonenumber actually recognises.
  const parsed = parsePhoneNumberFromString(phone, DEFAULT_COUNTRY);
  if (parsed?.isValid()) {
    variants.add(`+${parsed.countryCallingCode}0${parsed.nationalNumber}`);
  }
  return [...variants];
}
