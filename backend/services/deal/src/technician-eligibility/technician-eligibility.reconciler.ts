import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TechnicianEligibilityRepository } from './technician-eligibility.repository';
import { InternalHttpService } from '../common/services/internal-http.service';

/**
 * Boot-time convergence: make the eligibility projection equal to the roster
 * user-service reports, in both directions.
 *
 * It used to only add. That was safe against a user-service outage and wrong
 * about everything else: a row that got in when it should not have — someone
 * who was never a technician, a technician since demoted, a row written
 * straight into the table by a seed script — had no way out, because the only
 * removal path was a `tech.updated` for a person no longer being edited as a
 * technician, which never comes. Those rows stayed in the assignment dialog
 * for good.
 *
 * Events keep the projection current between boots; this is what guarantees it
 * converges, including for rows no event will ever mention.
 *
 * Idempotent; runs every boot.
 */
@Injectable()
export class TechnicianEligibilityReconciler implements OnModuleInit {
  private readonly logger = new Logger(TechnicianEligibilityReconciler.name);

  constructor(
    private readonly repository: TechnicianEligibilityRepository,
    private readonly http: InternalHttpService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.reconcile();
    } catch (err) {
      this.logger.warn(
        `Technician eligibility reconcile on boot failed: ${(err as Error).message}`,
      );
    }
  }

  private async reconcile(): Promise<void> {
    const assignable = await this.http.listAssignableTechnicians();

    // Two answers this must never act on, because deleting is irreversible
    // here and both are indistinguishable from "user-service is having a bad
    // minute": no answer at all, and an empty roster. A real empty roster —
    // a brand-new tenant — leaves the projection untouched for one boot,
    // which costs nothing because there is nothing to remove.
    if (assignable === null) {
      this.logger.warn('Skipping eligibility reconcile: user-service did not answer');
      return;
    }
    if (assignable.length === 0) {
      this.logger.warn('Skipping eligibility reconcile: user-service reported no technicians');
      return;
    }

    const projected = await this.repository.listAll();
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

    const keep = new Set(assignable.map((a) => a.technicianId));
    const stale = projected.filter((p) => !keep.has(p.technicianId));
    for (const row of stale) {
      await this.repository.remove(row.technicianId);
      this.logger.log(
        `Removed ${row.technicianId} (${row.firstName ?? '?'} ${row.lastName ?? '?'}) — ` +
          'not an assignable technician in user-service',
      );
    }

    this.logger.log(
      `Technician eligibility reconciled: ${assignable.length} projected, ${stale.length} removed`,
    );
  }
}
