import { Module, forwardRef } from '@nestjs/common';
import { ExtsService } from './exts.service';
import { ExtsRepository } from './exts.repository';
import { ExtsController } from './exts.controller';
import { DialInService } from './dial-in.service';
import { CallsModule } from '../calls/calls.module';
import { VoiceModule } from '../voice/voice.module';
import { TelephonyModule } from '../telephony/telephony.module';
import { DealReadService } from '../common/deal-read.service';
import { ContactLookupService } from '../common/contact-lookup.service';
import { UserPhoneLookupService } from '../common/user-phone-lookup.service';

/**
 * Job codes and the technician dial-in.
 *
 * Depends on VoiceModule for the caller-id resolver and on CallsModule for the
 * bridge context — the dial-in is a second way INTO the same conference, not a
 * second conference implementation.
 */
@Module({
  imports: [
    TelephonyModule,
    forwardRef(() => CallsModule),
    forwardRef(() => VoiceModule),
  ],
  controllers: [ExtsController],
  providers: [
    ExtsService,
    ExtsRepository,
    DialInService,
    DealReadService,
    ContactLookupService,
    // Names the caller from their own number — see DialInService.identify.
    // Its own provider rather than an import: it is a stateless cache-in-front
    // of one internal endpoint, exactly as CallsModule provides it.
    UserPhoneLookupService,
  ],
  exports: [ExtsService, DialInService],
})
export class ExtsModule {}
