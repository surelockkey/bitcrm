import { Module } from '@nestjs/common';
import { CallFlowsModule } from '../../call-flows/call-flows.module';
import { NumbersModule } from '../../numbers/numbers.module';
import { DealTotalsClient } from '../../common/deal-totals.client';
import { CallTrackingController } from './call-tracking.controller';
import { CallTrackingRepository } from './call-tracking.repository';
import { CallTrackingService } from './call-tracking.service';
import { CallTrackingSnapshotScheduler } from './call-tracking.scheduler';

/** Workiz Reports → Call Tracking. Reads the call log; writes nothing but its Redis snapshots. */
@Module({
  imports: [CallFlowsModule, NumbersModule],
  controllers: [CallTrackingController],
  providers: [CallTrackingRepository, CallTrackingService, CallTrackingSnapshotScheduler, DealTotalsClient],
})
export class CallTrackingModule {}
