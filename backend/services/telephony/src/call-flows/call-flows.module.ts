import { Module } from '@nestjs/common';
import { CallFlowsController } from './call-flows.controller';
import { CallFlowsService } from './call-flows.service';
import { CallFlowsRepository } from './call-flows.repository';
import { FlowAudioService } from './flow-audio.service';
import { CallGroupsModule } from '../call-groups/call-groups.module';
import { PresenceModule } from '../presence/presence.module';
import { CallDevicesModule } from '../call-devices/call-devices.module';

@Module({
  // A Forward step names a group, a user or a device, and saving a flow
  // checks it still exists — the directory comes with PresenceModule.
  imports: [CallGroupsModule, PresenceModule, CallDevicesModule],
  controllers: [CallFlowsController],
  providers: [CallFlowsService, CallFlowsRepository, FlowAudioService],
  exports: [CallFlowsService, FlowAudioService],
})
export class CallFlowsModule {}
