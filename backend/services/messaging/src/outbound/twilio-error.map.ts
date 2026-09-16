import { type MessageStatus } from '@bitcrm/types';

/**
 * Twilio error codes the outbound path expects to see, with the words the
 * inbox shows under the failed bubble. Status callbacks carry only the code
 * (design §4.5), so the text has to come from here.
 */
export const TWILIO_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  '21211': 'Invalid recipient phone number',
  '21408': 'Sending to this region is not enabled on the account',
  '21606': 'The sender number is not owned by the account or cannot send SMS',
  '21610': 'The recipient has opted out (STOP)',
  '21612': 'The recipient is not reachable from this sender number',
  '21614': 'The recipient number is not a mobile number',
  '21617': 'The message is too long',
  '21619': 'A message needs a body or an attachment',
  '21620': 'An attachment URL could not be fetched',
  '21623': 'Too many attachments',
  '30003': 'The recipient handset is unreachable or switched off',
  '30004': 'The message was blocked by the carrier',
  '30005': 'The recipient number is unknown or no longer in service',
  '30006': 'The recipient number is a landline or an unreachable carrier',
  '30007': 'The message was filtered by the carrier (flagged as spam)',
  '30008': 'The carrier reported an unknown error',
  '30032': 'The toll-free sender number is not verified yet',
  '30034': 'The sender number is not registered for A2P 10DLC',
};

/** A human line for an error code: Twilio's own message when it has one, else ours. */
export function describeTwilioError(code: string | undefined, providerMessage?: string | null): string | undefined {
  if (providerMessage) return providerMessage;
  if (!code) return undefined;
  return TWILIO_ERROR_MESSAGES[code] ?? `Twilio error ${code}`;
}

/** What the worker does with a failed `messages.create` (design §4.4 step 4). */
export type TwilioErrorAction =
  /** Transient (429 / 5xx / network): throw so SQS redelivers; the DLQ catches the fifth. */
  | { kind: 'retry'; reason: string }
  /** Stable reason (a 4xx): the message is `failed` with the code; 21610 also flips the STOP list. */
  | { kind: 'fail'; errorCode: string; errorMessage: string; optOut: boolean };

/** The fields of a Twilio `RestException` (or a network error) the classifier reads. */
export interface TwilioLikeError {
  /** Twilio error code, e.g. 21610. */
  code?: number | string | null;
  /** HTTP status of the REST response; absent for network failures. */
  status?: number | null;
  message?: string;
}

export const OPT_OUT_ERROR_CODE = '21610';

export function classifyTwilioError(err: unknown): TwilioErrorAction {
  const e = (err ?? {}) as TwilioLikeError;
  const code = e.code !== undefined && e.code !== null && e.code !== '' ? String(e.code) : undefined;
  const status = typeof e.status === 'number' ? e.status : undefined;
  const message = e.message || 'Twilio request failed';

  if (code === OPT_OUT_ERROR_CODE) {
    return { kind: 'fail', errorCode: code, errorMessage: describeTwilioError(code, message)!, optOut: true };
  }
  if (code === '20429' || status === 429) return { kind: 'retry', reason: `rate limited: ${message}` };
  if (status === undefined || status >= 500) return { kind: 'retry', reason: message };

  // Any other 4xx has a reason that will not change on a retry.
  const errorCode = code ?? String(status);
  return { kind: 'fail', errorCode, errorMessage: describeTwilioError(errorCode, message)!, optOut: false };
}

/**
 * Twilio message statuses → ours (design §3.2, §4.5). `accepted` and
 * `scheduled` are Twilio's own pre-queue states; `partially_delivered` only
 * happens for multi-part MMS and reads as delivered for the ticks.
 */
const STATUS_MAP: Readonly<Record<string, MessageStatus>> = {
  accepted: 'queued',
  scheduled: 'queued',
  queued: 'queued',
  sending: 'sending',
  sent: 'sent',
  delivered: 'delivered',
  partially_delivered: 'delivered',
  undelivered: 'undelivered',
  failed: 'failed',
  canceled: 'canceled',
  read: 'read',
};

export function mapTwilioStatus(raw: string | undefined | null): MessageStatus | undefined {
  if (!raw) return undefined;
  return STATUS_MAP[raw.toLowerCase()];
}
