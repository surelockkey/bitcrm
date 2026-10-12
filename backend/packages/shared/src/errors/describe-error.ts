/**
 * What an exception nobody turned into an HttpException means to the person
 * who clicked: a status and a reason they can act on or report. Every reply
 * used to be a bare "Internal server error" — the real cause (a Cognito
 * refusal, a peer service down, a write that lost a race) was only in the logs.
 */
export interface ErrorDescription {
  status: number;
  message: string;
}

type Rule = { status: number; say: (reason: string) => string };

const asIs = (status: number): Rule => ({ status, say: (reason) => reason });

/** AWS SDK v3 sets `name` to the service's exception type. */
const AWS_RULES: Record<string, Rule> = {
  // Cognito
  UserNotFoundException: {
    status: 404,
    say: (r) => `This person has no sign-in account (${r})`,
  },
  UnsupportedUserStateException: {
    status: 409,
    say: (r) => `The sign-in account's current state does not allow this (${r})`,
  },
  UsernameExistsException: asIs(409),
  AliasExistsException: asIs(409),
  NotAuthorizedException: asIs(400),
  InvalidPasswordException: asIs(400),
  InvalidParameterException: asIs(400),
  CodeMismatchException: asIs(400),
  ExpiredCodeException: asIs(400),
  UserNotConfirmedException: asIs(400),
  PasswordResetRequiredException: asIs(400),
  LimitExceededException: asIs(429),
  TooManyRequestsException: { status: 429, say: (r) => `Too many attempts — try again in a few minutes (${r})` },
  TooManyFailedAttemptsException: asIs(429),
  CodeDeliveryFailureException: {
    status: 502,
    say: (r) => `The email or text could not be sent (${r})`,
  },
  // DynamoDB
  ConditionalCheckFailedException: {
    status: 409,
    say: () => 'This record was changed by someone else or no longer exists. Reload and try again.',
  },
  TransactionCanceledException: {
    status: 409,
    say: (r) => `This change clashed with another one made at the same time. Reload and try again. (${r})`,
  },
  TransactionConflictException: {
    status: 409,
    say: (r) => `This change clashed with another one made at the same time. Reload and try again. (${r})`,
  },
  ProvisionedThroughputExceededException: {
    status: 503,
    say: (r) => `The database is busy right now — try again in a moment (${r})`,
  },
  ThrottlingException: {
    status: 503,
    say: (r) => `The server is busy right now — try again in a moment (${r})`,
  },
  RequestLimitExceeded: {
    status: 503,
    say: (r) => `The database is busy right now — try again in a moment (${r})`,
  },
  // S3
  NoSuchKey: { status: 404, say: (r) => `The file is not there any more (${r})` },
};

/** Socket-level failures from Node (fetch, axios, the SDKs). */
const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ERR_SOCKET_CONNECTION_TIMEOUT',
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** The reason an envelope (ours or anyone's JSON) gives, if it gives one. */
function messageOf(body: unknown): string | null {
  if (!isRecord(body)) return typeof body === 'string' && body ? body : null;
  const { message, error } = body;
  if (typeof message === 'string' && message) return message;
  if (Array.isArray(message) && message.length) return message.join(', ');
  if (isRecord(error) && typeof error.message === 'string' && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return null;
}

/** "crm" out of http://crm.bitcrm.local:4002 or /api/crm/… — which peer did not answer. */
function peerName(config: unknown): string {
  if (!isRecord(config)) return 'another service';
  const url = `${config.baseURL ?? ''}${config.url ?? ''}`;
  const prefix = /\/api\/([a-z-]+)/.exec(url)?.[1];
  if (prefix) return `the ${prefix} service`;
  try {
    return new URL(url).host || 'another service';
  } catch {
    return 'another service';
  }
}

export function describeError(exception: unknown): ErrorDescription {
  if (!(exception instanceof Error)) {
    const text = typeof exception === 'string' ? exception : JSON.stringify(exception);
    return { status: 500, message: `Server error: ${text || 'no details'}` };
  }

  const err = exception as Error & Record<string, unknown>;
  const reason = err.message || err.name || 'no details';

  // A call to another BitCRM service (InternalHttpService is axios).
  if (err.isAxiosError === true) {
    const res = isRecord(err.response) ? err.response : undefined;
    const peer = peerName(err.config);
    if (!res) {
      return {
        status: 503,
        message: `${peer} is not responding (${err.code ?? reason}). Try again in a minute.`,
      };
    }
    const status = typeof res.status === 'number' ? res.status : 502;
    const upstream = messageOf(res.data) ?? reason;
    if (status >= 400 && status < 500) return { status, message: upstream };
    return { status: 502, message: `${peer} failed: ${upstream}` };
  }

  // Stripe (`type` is the error class: StripeCardError, StripeInvalidRequestError, …).
  if (typeof err.type === 'string' && err.type.startsWith('Stripe')) {
    if (err.type === 'StripeCardError') return { status: 402, message: reason };
    return { status: 502, message: `Stripe: ${reason}` };
  }

  // Twilio's RestException: an HTTP `status`, a numeric `code` and a docs link.
  if (typeof err.status === 'number' && typeof err.code === 'number' && 'moreInfo' in err) {
    const status = err.status >= 400 && err.status < 500 ? 400 : 502;
    return { status, message: `Twilio: ${reason}` };
  }

  const rule = AWS_RULES[err.name];
  if (rule) return { status: rule.status, message: rule.say(reason) };

  if (typeof err.code === 'string' && NETWORK_CODES.has(err.code)) {
    return { status: 503, message: `Could not reach a service this needs (${err.code}): ${reason}` };
  }

  const name = err.name && err.name !== 'Error' ? `${err.name}: ` : '';
  return { status: 500, message: `Server error — ${name}${reason}` };
}
