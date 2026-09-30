import { Module } from '@nestjs/common';
import { TechnicianEligibilityRepository } from './technician-eligibility.repository';
import { TechnicianEligibilityEventHandler } from './technician-eligibility.event-handler';
import { TechnicianEligibilityReconciler } from './technician-eligibility.reconciler';
import { InternalHttpService } from '../common/services/internal-http.service';

@Module({
  providers: [
    TechnicianEligibilityRepository,
    TechnicianEligibilityEventHandler,
    TechnicianEligibilityReconciler,
    InternalHttpService,
  ],
  exports: [TechnicianEligibilityEventHandler, TechnicianEligibilityRepository],
})
export class TechnicianEligibilityModule {}
