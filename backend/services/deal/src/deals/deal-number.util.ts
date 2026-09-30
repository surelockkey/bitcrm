import { randomInt } from 'crypto';

/**
 * Human-facing Job ID codes: 6 random chars of uppercase letters + digits
 * (e.g. "K4T9ZW"). Every code contains at least one letter AND one digit, so a
 * code can never read as a pure number — legacy sequential dealNumbers (1001,
 * 1002, …) stay unambiguous in search and in the DB.
 */
export const DEAL_NUMBER_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const DEAL_NUMBER_LENGTH = 6;

const HAS_LETTER = /[A-Z]/;
const HAS_DIGIT = /[0-9]/;

export function generateDealNumberCode(): string {
  // Rejection sampling: all-letter odds are (26/36)^6 ≈ 14%, all-digit ≈ 0.05%,
  // so a retry loop terminates almost immediately.
  for (;;) {
    let code = '';
    for (let i = 0; i < DEAL_NUMBER_LENGTH; i++) {
      code += DEAL_NUMBER_CHARSET[randomInt(DEAL_NUMBER_CHARSET.length)];
    }
    if (HAS_LETTER.test(code) && HAS_DIGIT.test(code)) return code;
  }
}

/**
 * True when a search token looks like a Job ID code: six letters or digits.
 * Our own codes always mix the two, but the Workiz codes carried over do
 * not (49 059 are letters only, 34 digits only), and a search must find
 * every one of them.
 */
export function isDealNumberCode(value: string): boolean {
  const v = value.toUpperCase();
  return v.length === DEAL_NUMBER_LENGTH && /^[A-Z0-9]+$/.test(v);
}
