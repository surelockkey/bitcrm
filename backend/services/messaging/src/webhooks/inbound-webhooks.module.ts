import { Module } from '@nestjs/common';
import { TwilioModule } from '../common/twilio/twilio.module';
import { InboundModule } from '../inbound/inbound.module';
import { FallbackWebhookController } from './fallback.controller';
import { InboundWebhookController } from './inbound.controller';

/**
 * The two Twilio-facing inbound routes (design §4.3). `TwilioModule` is
 * imported so `TwilioSignatureGuard`, instantiated in this module's scope,
 * can resolve `TWILIO_CONFIG`.
 */
@Module({
  imports: [TwilioModule, InboundModule],
  controllers: [InboundWebhookController, FallbackWebhookController],
})
export class InboundWebhooksModule {}
