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
import { UserStatus } from '../enums/user-status.enum';

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
 * The approvals half of the dispatch rule: at least one approved job type AND
 * one approved service area. Answers "has this technician finished onboarding",
 * which is all the onboarding tracker needs.
 *
 * It is NOT the rule for "may be offered on a job" — that is
 * `isAssignableTechnician` below, which also asks who the person is.
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

/** The role a person must hold to be dispatched to a job. */
export const TECHNICIAN_ROLE_ID = 'role-technician';

/** The part of a user record the dispatch rule reads. */
export interface AssignableTechnicianSubject {
  roleId?: string;
  status?: UserStatus;
}

/**
 * THE definition of "may be offered on a job", in one place because the two
 * paths that write deal-service's eligibility projection used to each carry
 * their own and disagree: the boot roster filtered by the technician role, the
 * per-user refresh behind `tech.approved` / `tech.updated` never looked at the
 * role at all. Anyone holding an approved job type and service area — a
 * dispatcher, a manager — was therefore projected as an assignable technician
 * and offered in the assignment dialog.
 *
 * Both callers pass the *approved* catalog ids, so this cannot be fooled by a
 * pending or rejected assignment row.
 *
 * Deactivation is read as an explicit INACTIVE rather than "not ACTIVE": a
 * record from before the status field existed must not silently drop a working
 * technician out of dispatch, while `deactivate()` always writes INACTIVE.
 */
export function isAssignableTechnician(
  user: AssignableTechnicianSubject | null | undefined,
  approvedJobTypeIds: readonly string[],
  approvedServiceAreaIds: readonly string[],
): boolean {
  if (!user) return false;
  if (user.roleId !== TECHNICIAN_ROLE_ID) return false;
  if (user.status === UserStatus.INACTIVE) return false;
  return approvedJobTypeIds.length > 0 && approvedServiceAreaIds.length > 0;
}
