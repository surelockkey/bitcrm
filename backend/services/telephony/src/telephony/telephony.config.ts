/**
 * Twilio configuration, resolved from environment once at module init and
 * injected (rather than read via `process.env` inside services) so unit tests
 * can supply a fake config without touching the environment.
 */
export interface TelephonyConfig {
  accountSid: string;
  authToken: string;
  apiKey: string;
  apiSecret: string;
  twimlAppSid: string;
  /** The purchased Twilio number, E.164 — used as callerId for outbound dials. */
  callerId: string;
  /**
   * Fallback caller id for legs the SYSTEM places (the masked bridge, the
   * technician dial-in) when the job's market has no number of its own. Sits
   * above `callerId` in that chain, so a workspace can keep its legacy main
   * line while masked calls go out on a dedicated number.
   */
  defaultAreaCallerId: string;
  /** Public base URL Twilio can reach (ngrok in dev, ALB in prod). */
  publicBaseUrl: string;
  /** Access-token lifetime in seconds. */
  tokenTtlSeconds: number;
  /**
   * Validate the `X-Twilio-Signature` on webhook requests. Default true; set
   * `TWILIO_VALIDATE_SIGNATURE=false` to exercise webhooks locally with curl.
   */
  validateSignature: boolean;
}

export const TELEPHONY_CONFIG = Symbol('TELEPHONY_CONFIG');

export function loadTelephonyConfig(): TelephonyConfig {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
    authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
    apiKey: process.env.TWILIO_API_KEY ?? '',
    apiSecret: process.env.TWILIO_API_SECRET ?? '',
    twimlAppSid: process.env.TWILIO_TWIML_APP_SID ?? '',
    callerId: process.env.TWILIO_CALLER_ID ?? '',
    defaultAreaCallerId: process.env.TELEPHONY_DEFAULT_AREA_CALLER_ID ?? '',
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? '',
    tokenTtlSeconds: Number(process.env.TWILIO_TOKEN_TTL_SECONDS ?? 3600),
    validateSignature: process.env.TWILIO_VALIDATE_SIGNATURE !== 'false',
  };
}
