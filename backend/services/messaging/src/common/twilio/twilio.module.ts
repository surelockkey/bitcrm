import { Module } from '@nestjs/common';
import {
  TWILIO_CONFIG,
  TwilioRest,
  TwilioSignatureGuard,
  loadTwilioConfig,
  type TwilioConfig,
} from '@bitcrm/shared';

/**
 * The Twilio primitives every messaging module shares (design §2.2):
 * `TWILIO_CONFIG` resolved once from the environment, one lazily-built REST
 * client behind `TwilioRest`, and the webhook signature guard, which reads
 * the same config. Telephony provides its superset `TelephonyConfig` under
 * the same token; here the plain `TwilioConfig` (with `messagingServiceSid`)
 * is all that is needed.
 */
@Module({
  providers: [
    { provide: TWILIO_CONFIG, useFactory: loadTwilioConfig },
    {
      provide: TwilioRest,
      useFactory: (config: TwilioConfig) => new TwilioRest(config),
      inject: [TWILIO_CONFIG],
    },
    TwilioSignatureGuard,
  ],
  exports: [TWILIO_CONFIG, TwilioRest, TwilioSignatureGuard],
})
export class TwilioModule {}
