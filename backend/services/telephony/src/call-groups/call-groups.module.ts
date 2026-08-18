import { Module } from '@nestjs/common';
import { CallGroupsController } from './call-groups.controller';
import { CallGroupsService } from './call-groups.service';
import { CallGroupsRepository } from './call-groups.repository';
import { PresenceModule } from '../presence/presence.module';

@Module({
  // Membership is resolved against the same directory + presence the transfer
  // picker uses, so the two can never disagree about who is reachable.
  imports: [PresenceModule],
  controllers: [CallGroupsController],
  providers: [CallGroupsService, CallGroupsRepository],
  exports: [CallGroupsService],
})
export class CallGroupsModule {}
