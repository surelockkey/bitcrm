import { Module } from '@nestjs/common';
import { CallFlowsController } from './call-flows.controller';
import { CallFlowsService } from './call-flows.service';
import { CallFlowsRepository } from './call-flows.repository';
import { CallGroupsModule } from '../call-groups/call-groups.module';

@Module({
  // A `ring` step names a group, and saving a flow checks it still exists.
  imports: [CallGroupsModule],
  controllers: [CallFlowsController],
  providers: [CallFlowsService, CallFlowsRepository],
  exports: [CallFlowsService],
})
export class CallFlowsModule {}
