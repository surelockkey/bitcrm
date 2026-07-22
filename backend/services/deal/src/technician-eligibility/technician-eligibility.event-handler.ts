import { Injectable, Logger, Optional } from '@nestjs/common';
import { BusinessMetricsService } from '@bitcrm/shared';
import {
  UserEventType,
  type TechApprovedEvent,
  type TechUpdatedEvent,
} from '@bitcrm/types';
import { TechnicianEligibilityRepository } from './technician-eligibility.repository';
import {
  InternalHttpService,
  type TechnicianEligibilityInfo,
} from '../common/services/internal-http.service';

/** `changedFields` value that means "job types or service areas moved". */
export const ASSIGNMENTS_CHANGED = 'assignments';

@Injectable()
export class TechnicianEligibilityEventHandler {
  private readonly logger = new Logger(TechnicianEligibilityEventHandler.name);

  constructor(
    private readonly repository: TechnicianEligibilityRepository,
    private readonly http: InternalHttpService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {}

  /**
   * Both events converge here: the projection now stores display fields that
   * `tech.approved` doesn't carry, so either way we re-read the authoritative
   * record from user-service rather than trusting the payload alone.
   */
  private async refresh(technicianId: string): Promise<TechnicianEligibilityInfo> {
    const e = await this.http.getTechnicianEligibility(technicianId);

    if (!e.assignable) {
      await this.repository.remove(technicianId);
      this.logger.log(`Technician ${technicianId} no longer assignable (eligibility removed)`);
      return e;
    }

    await this.repository.upsert({
      technicianId: e.technicianId,
      jobTypeIds: e.jobTypeIds ?? [],
      serviceAreaIds: e.serviceAreaIds ?? [],
      assignable: true,
      firstName: e.firstName,
      lastName: e.lastName,
      department: e.department,
      homeAddress: e.homeAddress,
      updatedAt: new Date().toISOString(),
    });
    this.logger.log(`Technician ${e.technicianId} eligibility refreshed (assignable)`);
    return e;
  }

  private async track(eventType: string, fn: () => Promise<unknown>): Promise<void> {
    const timer = this.businessMetrics?.sqsProcessingDuration.startTimer({ event_type: eventType });
    try {
      await fn();
      timer?.();
      this.businessMetrics?.sqsMessagesProcessed.inc({ event_type: eventType, status: 'success' });
    } catch (error) {
      timer?.();
      this.businessMetrics?.sqsMessagesProcessed.inc({ event_type: eventType, status: 'error' });
      throw error;
    }
  }

  async handleTechApproved(payload: TechApprovedEvent): Promise<void> {
    await this.track(UserEventType.TECH_APPROVED, () => this.refresh(payload.technicianId));
  }

  async handleTechUpdated(payload: TechUpdatedEvent): Promise<void> {
    // Only job-type / service-area changes affect eligibility.
    if (!payload.changedFields?.includes(ASSIGNMENTS_CHANGED)) return;
    await this.track(UserEventType.TECH_UPDATED, () => this.refresh(payload.technicianId));
  }
}
