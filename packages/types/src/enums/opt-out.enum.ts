/** Opt-outs are kept per delivery channel: an SMS STOP says nothing about email. */
export const OPT_OUT_CHANNELS = ['sms', 'email'] as const;
export type OptOutChannel = (typeof OPT_OUT_CHANNELS)[number];

export const OPT_OUT_STATUSES = ['opted_out', 'opted_in'] as const;
export type OptOutStatus = (typeof OPT_OUT_STATUSES)[number];

/**
 * What flipped the status. Twilio's own list does not survive a number move
 * between accounts, so BitCRM keeps its own (design §4.7).
 */
export const OPT_OUT_SOURCES = [
  'advanced_opt_out',
  'error_21610',
  'ses_bounce',
  'ses_complaint',
  'manual',
  'workiz_import',
] as const;
export type OptOutSource = (typeof OPT_OUT_SOURCES)[number];

/** Twilio's default opt-out / opt-in keywords, uppercase, exact match. */
export const OPT_OUT_KEYWORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'] as const;
export const OPT_IN_KEYWORDS = ['START', 'YES', 'UNSTOP'] as const;
