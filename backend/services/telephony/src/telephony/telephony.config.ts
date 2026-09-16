import {
  TWILIO_CONFIG,
  loadTwilioConfig,
  type TwilioConfig,
} from '@bitcrm/shared';

/**
 * Twilio configuration, resolved from environment once at module init and
 * injected (rather than read via `process.env` inside services) so unit tests
 * can supply a fake config without touching the environment.
 *
 * The account-level part (`accountSid`, `authToken`, `publicBaseUrl`,
 * `validateSignature`, `messagingServiceSid`) is `TwilioConfig` from
 * `@bitcrm/shared`, which is what the shared `TwilioSignatureGuard` and
 * `TwilioRest` read; the voice-specific fields below are telephony's own.
 */
export interface TelephonyConfig extends TwilioConfig {
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
  /** Access-token lifetime in seconds. */
  tokenTtlSeconds: number;
}

/**
 * The same token as the shared `TWILIO_CONFIG`, on purpose: `TelephonyModule`
 * provides one `TelephonyConfig` object, and because it is a superset of
 * `TwilioConfig`, the shared guard and REST wrapper resolve it without a
 * second provider or an alias.
 */
export const TELEPHONY_CONFIG = TWILIO_CONFIG;

export function loadTelephonyConfig(): TelephonyConfig {
  return {
    ...loadTwilioConfig(),
    apiKey: process.env.TWILIO_API_KEY ?? '',
    apiSecret: process.env.TWILIO_API_SECRET ?? '',
    twimlAppSid: process.env.TWILIO_TWIML_APP_SID ?? '',
    callerId: process.env.TWILIO_CALLER_ID ?? '',
    defaultAreaCallerId: process.env.TELEPHONY_DEFAULT_AREA_CALLER_ID ?? '',
    tokenTtlSeconds: Number(process.env.TWILIO_TOKEN_TTL_SECONDS ?? 3600),
  };
}
