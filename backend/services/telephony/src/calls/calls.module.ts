import { forwardRef, Module } from '@nestjs/common';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { CallsRepository } from './calls.repository';
import { CallEventsBus } from './call-events.bus';
import { UserNamesService } from '../common/user-names.service';
import { TelephonyModule } from '../telephony/telephony.module';
import { VoiceModule } from '../voice/voice.module';

@Module({
  // VoiceModule provides ConferenceService (monitor grants) and itself imports
  // CallsModule for the record writer — hence the forwardRef pair.
  imports: [TelephonyModule, forwardRef(() => VoiceModule)],
  controllers: [CallsController],
  providers: [CallsService, CallsRepository, CallEventsBus, UserNamesService],
  exports: [CallsService, CallEventsBus],
})
export class CallsModule {}
