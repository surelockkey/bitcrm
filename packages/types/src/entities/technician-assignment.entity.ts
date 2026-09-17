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
  fieldTeamMember?: boolean;
}

/**
 * Whether this person goes out on jobs. The flag is Workiz's "Field team
 * member" and lives on the user, whatever their role; a record from before it
 * existed answers from the role, so that on the day the flag arrived nobody
 * moved: every technician was on the field team, nobody else was.
 */
export function isFieldTeamMember(
  user: Pick<AssignableTechnicianSubject, 'roleId' | 'fieldTeamMember'>,
): boolean {
  return user.fieldTeamMember ?? user.roleId === TECHNICIAN_ROLE_ID;
}

/**
 * THE definition of "may be put on a job", in one place because the two paths
 * that write deal-service's eligibility projection used to each carry their
 * own and disagree.
 *
 * Membership of the field team is the whole rule. Approved job types and
 * service areas no longer gate it: they say whether someone *fits* a given
 * job, which is `eligible` and the ranking in the assignment dialog — the
 * owner who wants a job sent to their phone has no approvals and must still
 * be assignable.
 *
 * Deactivation is read as an explicit INACTIVE rather than "not ACTIVE": a
 * record from before the status field existed must not silently drop a working
 * technician out of dispatch, while `deactivate()` always writes INACTIVE.
 */
export function isAssignableTechnician(
  user: AssignableTechnicianSubject | null | undefined,
): boolean {
  if (!user) return false;
  if (!isFieldTeamMember(user)) return false;
  return user.status !== UserStatus.INACTIVE;
}
