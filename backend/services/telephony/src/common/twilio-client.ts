/**
 * Moved to `@bitcrm/shared` (`backend/packages/shared/src/twilio/twilio-rest.ts`)
 * so the messaging service can share it. This shim keeps the old import path
 * alive; new code should import from `@bitcrm/shared` directly.
 */
export { TwilioRest, toTwilioHttpException } from '@bitcrm/shared';
export type { TwilioCredentials, TwilioClientFactory } from '@bitcrm/shared';
