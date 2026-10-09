/**
 * A dispatchable kind of work (Lockout, Rekey, Gate Repair, …), managed as a
 * catalog in Settings. Deals reference exactly one; technicians are approved
 * for many, and the two are matched to build the eligible-technician list.
 *
 * Deliberately mirrors ServiceArea minus the geometry, so both catalogs share
 * the same priority/active semantics, repository shape and settings UI.
 */
export interface JobType {
  id: string;
  name: string;
  /** Higher sorts first in pickers; also the list sort key. */
  priority: number;
  /** Archived types stay resolvable on historical deals but leave the pickers. */
  active: boolean;
  /**
   * How long this kind of job usually takes, in minutes — Workiz's Duration
   * (days / hours / minutes on the job type). Picking the type on New Job or
   * the job page sets the visit's end to its start plus this; an unscheduled
   * job dropped on the calendar gets a block this long. Absent or 0: no
   * duration of its own, and the pickers fall back to an hour.
   */
  durationMinutes?: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
