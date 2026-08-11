import { forwardRef, Module } from '@nestjs/common';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { ConferenceService } from './conference.service';
import { PresenceModule } from '../presence/presence.module';
import { CallsModule } from '../calls/calls.module';
import { TelephonyModule } from '../telephony/telephony.module';
import { NumbersModule } from '../numbers/numbers.module';
import { TwilioSignatureGuard } from '../common/twilio-signature.guard';

@Module({
  // TelephonyModule exports TELEPHONY_CONFIG (needed by the signature guard);
  // NumbersModule exports NumbersService (default caller-id fallback);
  // CallsModule is a forwardRef pair (its controller needs ConferenceService).
  imports: [
    TelephonyModule,
    PresenceModule,
    forwardRef(() => CallsModule),
    NumbersModule,
  ],
  controllers: [VoiceController],
  providers: [VoiceService, ConferenceService, TwilioSignatureGuard],
  exports: [ConferenceService],
})
export class VoiceModule {}
