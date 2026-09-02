import { forwardRef, Module } from '@nestjs/common';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { ConferenceService } from './conference.service';
import { FlowRunnerService } from './flow-runner.service';
import { CallFlowsModule } from '../call-flows/call-flows.module';
import { PresenceModule } from '../presence/presence.module';
import { CallsModule } from '../calls/calls.module';
import { TelephonyModule } from '../telephony/telephony.module';
import { NumbersModule } from '../numbers/numbers.module';
import { CallGroupsModule } from '../call-groups/call-groups.module';
import { TwilioSignatureGuard } from '../common/twilio-signature.guard';
import { CallerIdResolver } from './caller-id.resolver';
import { ServiceAreaNumbersService } from '../common/service-area-numbers.service';
import { DealReadService } from '../common/deal-read.service';
import { ExtsModule } from '../exts/exts.module';

@Module({
  // TelephonyModule exports TELEPHONY_CONFIG (needed by the signature guard);
  // NumbersModule exports NumbersService (default caller-id fallback);
  // CallsModule is a forwardRef pair (its controller needs ConferenceService).
  imports: [
    TelephonyModule,
    PresenceModule,
    forwardRef(() => CallsModule),
    NumbersModule,
    // The flow runner reads flows and the groups they ring.
    CallFlowsModule,
    CallGroupsModule,
    // The flow runner's ext node resolves through the dial-in service.
    forwardRef(() => ExtsModule),
  ],
  controllers: [VoiceController],
  providers: [
    VoiceService,
    ConferenceService,
    FlowRunnerService,
    TwilioSignatureGuard,
    CallerIdResolver,
    ServiceAreaNumbersService,
    DealReadService,
  ],
  // CallerIdResolver and DealReadService are exported for the bridge, which
  // lives on CallsController but places legs the way the voice side does.
  exports: [
    ConferenceService,
    CallerIdResolver,
    ServiceAreaNumbersService,
    DealReadService,
  ],
})
export class VoiceModule {}
