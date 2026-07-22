import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TechnicianEligibilityRepository } from './technician-eligibility.repository';
import { InternalHttpService } from '../common/services/internal-http.service';

/**
 * Boot-time self-heal: populate the eligibility projection for technicians who
 * were already approved before this consumer existed. Upsert-only (never
 * removes) so a transient user-service outage can't wipe the projection —
 * removals flow through tech.updated events. Idempotent; runs every boot.
 */
@Injectable()
export class TechnicianEligibilityBackfill implements OnModuleInit {
  private readonly logger = new Logger(TechnicianEligibilityBackfill.name);

  constructor(
    private readonly repository: TechnicianEligibilityRepository,
    private readonly http: InternalHttpService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const assignable = await this.http.listAssignableTechnicians();
      const now = new Date().toISOString();
      for (const a of assignable) {
        await this.repository.upsert({
          technicianId: a.technicianId,
          jobTypeIds: a.jobTypeIds ?? [],
          serviceAreaIds: a.serviceAreaIds ?? [],
          assignable: true,
          firstName: a.firstName,
          lastName: a.lastName,
          department: a.department,
          homeAddress: a.homeAddress,
          updatedAt: now,
        });
      }
      if (assignable.length > 0) {
        this.logger.log(`Backfilled ${assignable.length} technician eligibility projection(s) on boot`);
      }
    } catch (err) {
      this.logger.warn(
        `Technician eligibility backfill on boot failed: ${(err as Error).message}`,
      );
    }
  }
}
