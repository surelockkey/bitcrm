import { Module } from '@nestjs/common';
import {
  TWILIO_CONFIG,
  TwilioRest,
  loadTwilioConfig,
  type TwilioConfig,
} from '@bitcrm/shared';

/**
 * The Twilio account this service talks to, resolved once from the
 * environment (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `PUBLIC_BASE_URL`,
 * `TWILIO_VALIDATE_SIGNATURE`, `TWILIO_MESSAGING_SERVICE_SID`) and injected
 * under the shared `TWILIO_CONFIG` token — what `TwilioSignatureGuard` reads
 * on the webhooks and what `TwilioRest` signs REST calls with. Not global:
 * import it where a webhook controller or a Twilio-calling service lives.
 */
@Module({
  providers: [
    { provide: TWILIO_CONFIG, useFactory: () => loadTwilioConfig() },
    {
      provide: TwilioRest,
      useFactory: (config: TwilioConfig) => new TwilioRest(config),
      inject: [TWILIO_CONFIG],
    },
  ],
  exports: [TWILIO_CONFIG, TwilioRest],
})
export class TwilioModule {}
