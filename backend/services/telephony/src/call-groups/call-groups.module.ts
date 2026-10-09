import { Module } from '@nestjs/common';
import { CallGroupsController } from './call-groups.controller';
import { CallGroupsService } from './call-groups.service';
import { CallGroupsRepository } from './call-groups.repository';
import { PresenceModule } from '../presence/presence.module';
import { CallDevicesModule } from '../call-devices/call-devices.module';

@Module({
  // Membership is resolved against the same directory + presence the transfer
  // picker uses, so the two can never disagree about who is reachable — and
  // against the Devices catalog for the shop lines a group rings.
  imports: [PresenceModule, CallDevicesModule],
  controllers: [CallGroupsController],
  providers: [CallGroupsService, CallGroupsRepository],
  exports: [CallGroupsService],
})
export class CallGroupsModule {}
