/**
 * Twilio account configuration shared by every service that talks to Twilio
 * (telephony today, messaging next). Resolved from the environment once at
 * module init and injected under `TWILIO_CONFIG` — never read via
 * `process.env` inside services — so unit tests can supply a fake config
 * without touching the environment.
 *
 * In deployed environments the variables arrive on the task definition
 * (`backend/scripts/render-taskdef.sh`), locally from `backend/.env`; this
 * loader only cares that they are in `env`.
 *
 * A service that needs more than this (telephony's API key / TwiML app /
 * caller ids) extends `TwilioConfig` and provides the superset under the same
 * token — `TwilioSignatureGuard` and `TwilioRest` only ever read the fields
 * declared here.
 */
export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** Public base URL Twilio can reach (ngrok in dev, ALB in prod), no trailing slash. */
  publicBaseUrl: string;
  /**
   * Validate the `X-Twilio-Signature` on webhook requests. Default true; set
   * `TWILIO_VALIDATE_SIGNATURE=false` to exercise webhooks locally with curl.
   */
  validateSignature: boolean;
  /**
   * Messaging Service (`MG…`) the workspace's numbers are pooled in — the
   * sender for outbound SMS and the scope for "is this number SMS-ready".
   * Optional: absent until the owner has set one up in Twilio.
   */
  messagingServiceSid?: string;
}

export const TWILIO_CONFIG = Symbol('TWILIO_CONFIG');

/** Environment variables `loadTwilioConfig` reads, for `.env.example` and docs. */
export const TWILIO_ENV_VARS = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'PUBLIC_BASE_URL',
  'TWILIO_VALIDATE_SIGNATURE',
  'TWILIO_MESSAGING_SERVICE_SID',
] as const;

export function loadTwilioConfig(
  env: NodeJS.ProcessEnv = process.env,
): TwilioConfig {
  const config: TwilioConfig = {
    accountSid: env.TWILIO_ACCOUNT_SID ?? '',
    authToken: env.TWILIO_AUTH_TOKEN ?? '',
    publicBaseUrl: env.PUBLIC_BASE_URL ?? '',
    validateSignature: env.TWILIO_VALIDATE_SIGNATURE !== 'false',
  };
  // Only present when configured, so a `TelephonyConfig` literal in a test
  // that predates messaging still type-checks and serialises the same.
  if (env.TWILIO_MESSAGING_SERVICE_SID) {
    config.messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID;
  }
  return config;
}
