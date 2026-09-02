import { forwardRef, Module } from '@nestjs/common';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { CallsRepository } from './calls.repository';
import { CallEventsBus } from './call-events.bus';
import { UserNamesService } from '../common/user-names.service';
import { ContactLookupService } from '../common/contact-lookup.service';
import { UserPhoneLookupService } from '../common/user-phone-lookup.service';
import { UserDirectoryService } from '../common/user-directory.service';
import { DealLinkService } from '../common/deal-link.service';
import { PermissionLookupService } from '../common/permission-lookup.service';
import { BridgeService } from '../common/bridge.service';
import { PresenceModule } from '../presence/presence.module';
import { TelephonyModule } from '../telephony/telephony.module';
import { VoiceModule } from '../voice/voice.module';

@Module({
  // VoiceModule provides ConferenceService (monitor grants) and itself imports
  // CallsModule for the record writer — hence the forwardRef pair.
  imports: [TelephonyModule, PresenceModule, forwardRef(() => VoiceModule)],
  controllers: [CallsController],
  providers: [
    CallsService,
    CallsRepository,
    CallEventsBus,
    UserNamesService,
    ContactLookupService,
    UserPhoneLookupService,
    UserDirectoryService,
    DealLinkService,
    PermissionLookupService,
    BridgeService,
  ],
  exports: [CallsService, CallEventsBus, BridgeService],
})
export class CallsModule {}
