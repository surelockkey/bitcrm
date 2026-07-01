import { Injectable, Logger, Optional } from '@nestjs/common';
import { BusinessMetricsService } from '@bitcrm/shared';
import {
  UserEventType,
  type TechApprovedEvent,
  type TechUpdatedEvent,
} from '@bitcrm/types';
import { TechnicianEligibilityRepository } from './technician-eligibility.repository';
import { InternalHttpService } from '../common/services/internal-http.service';

@Injectable()
export class TechnicianEligibilityEventHandler {
  private readonly logger = new Logger(TechnicianEligibilityEventHandler.name);

  constructor(
    private readonly repository: TechnicianEligibilityRepository,
    private readonly http: InternalHttpService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {}

  async handleTechApproved(payload: TechApprovedEvent): Promise<void> {
    const timer = this.businessMetrics?.sqsProcessingDuration.startTimer({
      event_type: UserEventType.TECH_APPROVED,
    });
    try {
      await this.repository.upsert({
        technicianId: payload.technicianId,
        approvedSkills: payload.approvedSkills ?? [],
        serviceAreas: payload.serviceAreas ?? [],
        assignable: true,
        updatedAt: new Date().toISOString(),
      });
      this.logger.log(`Technician ${payload.technicianId} is assignable (eligibility updated)`);
      timer?.();
      this.businessMetrics?.sqsMessagesProcessed.inc({ event_type: UserEventType.TECH_APPROVED, status: 'success' });
    } catch (error) {
      timer?.();
      this.businessMetrics?.sqsMessagesProcessed.inc({ event_type: UserEventType.TECH_APPROVED, status: 'error' });
      throw error;
    }
  }

  async handleTechUpdated(payload: TechUpdatedEvent): Promise<void> {
    if (!payload.changedFields?.includes('skills')) return; // only skills affect eligibility

    const timer = this.businessMetrics?.sqsProcessingDuration.startTimer({
      event_type: UserEventType.TECH_UPDATED,
    });
    try {
      const e = await this.http.getTechnicianEligibility(payload.technicianId);
      if (e.assignable) {
        await this.repository.upsert({
          technicianId: e.technicianId,
          approvedSkills: e.approvedSkills,
          serviceAreas: e.serviceAreas,
          assignable: true,
          updatedAt: new Date().toISOString(),
        });
        this.logger.log(`Technician ${e.technicianId} eligibility refreshed (assignable)`);
      } else {
        await this.repository.remove(payload.technicianId);
        this.logger.log(`Technician ${payload.technicianId} no longer assignable (eligibility removed)`);
      }
      timer?.();
      this.businessMetrics?.sqsMessagesProcessed.inc({ event_type: UserEventType.TECH_UPDATED, status: 'success' });
    } catch (error) {
      timer?.();
      this.businessMetrics?.sqsMessagesProcessed.inc({ event_type: UserEventType.TECH_UPDATED, status: 'error' });
      throw error;
    }
  }
}
