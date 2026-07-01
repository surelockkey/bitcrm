import { Module } from '@nestjs/common';
import { TechnicianEligibilityRepository } from './technician-eligibility.repository';
import { TechnicianEligibilityEventHandler } from './technician-eligibility.event-handler';
import { TechnicianEligibilityBackfill } from './technician-eligibility.backfill';
import { InternalHttpService } from '../common/services/internal-http.service';

@Module({
  providers: [
    TechnicianEligibilityRepository,
    TechnicianEligibilityEventHandler,
    TechnicianEligibilityBackfill,
    InternalHttpService,
  ],
  exports: [TechnicianEligibilityEventHandler, TechnicianEligibilityRepository],
})
export class TechnicianEligibilityModule {}
