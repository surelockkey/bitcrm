import { BadRequestException } from '@nestjs/common';

/**
 * A dialable number → E.164, the one form every service stores and matches on.
 *
 * This has to agree byte-for-byte across services: telephony matches a call's
 * endpoint against both CRM contacts and system users, so a number normalized
 * one way here and another way there simply never matches. That is why it
 * lives in shared rather than being reimplemented per service.
 */
export function normalizePhone(phone: string): string {
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
