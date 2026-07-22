/**
 * What a technician is cleared to do, and where. Replaces the old single
 * `TechnicianSkill` row that discriminated on `type` and carried a free-text
 * `value` — the free text is what made deal↔technician matching fail, because
 * deals stored slugs (`lock_change`) and technicians typed titles (`Lock Change`).
 *
 * Both kinds share one review flow (propose → approve/reject, plus revoke) and
 * one storage table; they differ only in which catalog id they point at:
 *   PK = USER#<userId>, SK = JOBTYPE#<jobTypeId>
 *   PK = USER#<userId>, SK = AREA#<serviceAreaId>
 *
 * The catalog id *is* the identity — there is no separate assignment id — so a
 * duplicate proposal collapses onto the existing row instead of creating a second.
 */
export type AssignmentStatus = 'pending' | 'approved' | 'rejected';

interface TechnicianAssignmentBase {
  userId: string;
  status: AssignmentStatus;
  proposedBy: string;
  proposedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  comments?: string;
}

export interface TechnicianJobType extends TechnicianAssignmentBase {
  jobTypeId: string;
}

export interface TechnicianServiceArea extends TechnicianAssignmentBase {
  serviceAreaId: string;
}

/**
 * A technician may be dispatched once they hold at least one approved job type
 * AND one approved service area. This rule was previously duplicated across
 * user-service, deal-service and the web app; it now lives here alone.
 */
export function isAssignable(
  jobTypes: Pick<TechnicianJobType, 'status'>[],
  serviceAreas: Pick<TechnicianServiceArea, 'status'>[],
): boolean {
  return (
    jobTypes.some((j) => j.status === 'approved') &&
    serviceAreas.some((a) => a.status === 'approved')
  );
}
