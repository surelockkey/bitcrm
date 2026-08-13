/**
 * Re-exported from `@bitcrm/shared` so every service normalizes identically —
 * telephony matches call endpoints against both CRM contacts and system users,
 * and two implementations that drift apart would silently stop matching.
 * Kept as a module here so the existing `../common/phone-normalization.util`
 * imports don't all have to change.
 */
export {
  normalizePhone,
  normalizePhones,
  phoneMatchVariants,
} from '@bitcrm/shared';

/** `+14045551234` → `(404) 555-1234`. CRM-specific display helper. */
export function formatPhoneDisplay(normalized: string): string {
  const digits = normalized.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    const area = digits.slice(1, 4);
    const prefix = digits.slice(4, 7);
    const line = digits.slice(7, 11);
    return `(${area}) ${prefix}-${line}`;
  }
  return normalized;
}
