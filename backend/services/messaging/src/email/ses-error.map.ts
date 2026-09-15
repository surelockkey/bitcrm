import { type MessageStatus } from '@bitcrm/types';

/** What the worker does with a failed `SendEmail` (the `classifyTwilioError` shape). */
export type SesErrorAction =
  /** Throttled / 5xx / network: throw so SQS redelivers; the DLQ catches the fifth. */
  | { kind: 'retry'; reason: string }
  /** A reason that will not change on a retry: the message is `failed` with the code. */
  | { kind: 'fail'; errorCode: string; errorMessage: string };

/** The fields of an SDK `ServiceException` (or a network error) the classifier reads. */
export interface SesLikeError {
  name?: string;
  message?: string;
  $metadata?: { httpStatusCode?: number };
  $retryable?: unknown;
}

/** SES v2 exception names that mean "try again later". */
const RETRYABLE = new Set(['TooManyRequestsException', 'LimitExceededException', 'ThrottlingException']);

/** SES v2 exception names with a readable line for the failed bubble. */
export const SES_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  MessageRejected: 'SES rejected the message',
  MailFromDomainNotVerifiedException: 'The sender domain is not verified in SES',
  AccountSuspendedException: 'The SES account is suspended',
  SendingPausedException: 'Sending is paused on the SES account',
  NotFoundException: 'The SES configuration set or identity does not exist',
  BadRequestException: 'SES refused the request',
  SES_REJECT: 'SES rejected the message (virus detected)',
  SES_RENDERING_FAILURE: 'The message could not be rendered',
  SES_BOUNCE: 'The recipient mailbox rejected the message',
  SES_BOUNCE_TRANSIENT: 'The recipient mailbox is temporarily unavailable',
};

export function describeSesError(code: string | undefined, providerMessage?: string | null): string | undefined {
  if (!code) return providerMessage ?? undefined;
  const known = SES_ERROR_MESSAGES[code];
  if (known && providerMessage) return `${known}: ${providerMessage}`;
  return known ?? providerMessage ?? `SES error ${code}`;
}

export function classifySesError(err: unknown): SesErrorAction {
  const e = (err ?? {}) as SesLikeError;
  const name = e.name || undefined;
  const status = e.$metadata?.httpStatusCode;
  const message = e.message || 'SES request failed';

  if ((name && RETRYABLE.has(name)) || status === 429) return { kind: 'retry', reason: `rate limited: ${message}` };
  if (status === undefined || status >= 500) return { kind: 'retry', reason: message };
  const errorCode = name ?? String(status);
  return { kind: 'fail', errorCode, errorMessage: describeSesError(errorCode, message)! };
}

/**
 * SES event types (configuration-set event destination, `eventType`) → what
 * the message becomes (design §3.2 statuses). `Complaint` changes no status —
 * the mail was delivered, the recipient objected afterwards — it only flips
 * the opt-out ledger. `DeliveryDelay` and `Subscription` are informational.
 */
export type SesEventType =
  | 'Send'
  | 'Reject'
  | 'Bounce'
  | 'Complaint'
  | 'Delivery'
  | 'Open'
  | 'Click'
  | 'RenderingFailure'
  | 'DeliveryDelay'
  | 'Subscription';

export const SES_EVENT_STATUS: Readonly<Partial<Record<SesEventType, MessageStatus>>> = {
  Send: 'sent',
  Delivery: 'delivered',
  Reject: 'failed',
  RenderingFailure: 'failed',
  Bounce: 'undelivered',
  Open: 'opened',
  Click: 'clicked',
};

/**
 * The RFC 5322 `Message-ID` SES stamps on a message it accepted: the SES
 * message id at `email.amazonses.com` in us-east-1, `<region>.amazonses.com`
 * elsewhere. Stored as `emailMessageId` so a client's `In-Reply-To` can be
 * matched back to the line it answers.
 */
export function sesMessageIdHeader(sesMessageId: string, region: string): string {
  const host = region === 'us-east-1' ? 'email.amazonses.com' : `${region}.amazonses.com`;
  return `<${sesMessageId}@${host}>`;
}

/** The inverse: the SES message id inside a `Message-ID` SES produced, else `undefined`. */
export function sesMessageIdFromHeader(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^<?([^<>@\s]+)@(?:email|[a-z0-9-]+)\.amazonses\.com>?$/i.exec(header.trim());
  return m?.[1];
}
