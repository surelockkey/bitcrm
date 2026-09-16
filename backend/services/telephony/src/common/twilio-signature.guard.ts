/**
 * Moved to `@bitcrm/shared`
 * (`backend/packages/shared/src/twilio/twilio-signature.guard.ts`) so the
 * messaging service's SMS webhooks get the same check. The guard now injects
 * the shared `TWILIO_CONFIG` token — which `TELEPHONY_CONFIG` is an alias of —
 * so nothing in this service had to change. This shim keeps the old import
 * path alive; new code should import from `@bitcrm/shared` directly.
 */
export { TwilioSignatureGuard, isValidTwilioRequest } from '@bitcrm/shared';
export type { TwilioSignatureOptions, TwilioSignedRequest } from '@bitcrm/shared';
