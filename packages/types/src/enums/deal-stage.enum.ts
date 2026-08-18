export enum DealStage {
  NEW_LEAD = 'new_lead',
  ESTIMATE_SENT = 'estimate_sent',
  APPROVED = 'approved',
  ASSIGNED = 'assigned',
  EN_ROUTE = 'en_route',
  ON_SITE = 'on_site',
  WORK_IN_PROGRESS = 'work_in_progress',
  PENDING_PAYMENT = 'pending_payment',
  PENDING_PARTS = 'pending_parts',
  FOLLOW_UP = 'follow_up',
  ON_HOLD = 'on_hold',
  COMPLETED = 'completed',
  CANCELED = 'canceled',
}

export enum DealStageGroup {
  SUBMITTED = 'submitted',
  IN_PROGRESS = 'in_progress',
  PENDING = 'pending',
  CLOSED = 'closed',
}

export const STAGE_GROUPS: Record<DealStage, DealStageGroup> = {
  [DealStage.NEW_LEAD]: DealStageGroup.SUBMITTED,
  [DealStage.ESTIMATE_SENT]: DealStageGroup.SUBMITTED,
  [DealStage.APPROVED]: DealStageGroup.SUBMITTED,
  [DealStage.ASSIGNED]: DealStageGroup.IN_PROGRESS,
  [DealStage.EN_ROUTE]: DealStageGroup.IN_PROGRESS,
  [DealStage.ON_SITE]: DealStageGroup.IN_PROGRESS,
  [DealStage.WORK_IN_PROGRESS]: DealStageGroup.IN_PROGRESS,
  [DealStage.PENDING_PAYMENT]: DealStageGroup.PENDING,
  [DealStage.PENDING_PARTS]: DealStageGroup.PENDING,
  [DealStage.FOLLOW_UP]: DealStageGroup.PENDING,
  [DealStage.ON_HOLD]: DealStageGroup.PENDING,
  [DealStage.COMPLETED]: DealStageGroup.CLOSED,
  [DealStage.CANCELED]: DealStageGroup.CLOSED,
};

export const TERMINAL_STAGES = new Set<DealStage>([
  DealStage.COMPLETED,
  DealStage.CANCELED,
]);

/**
 * The fixed super-statuses that replace the old stage pipeline. Unlike the
 * 13-stage `DealStage`, this set is CLOSED — dispatchers can neither add nor
 * remove entries; they only create custom sub-statuses (DealSubStatus) under
 * each one. A deal carries a `superStatus` (one of these) plus an optional
 * `subStatusId`. Ordering below is the pipeline order shown in pickers/tabs.
 */
export enum JobSuperStatus {
  SUBMITTED = 'submitted',
  IN_PROGRESS = 'in_progress',
  DONE = 'done',
  PENDING = 'pending',
  DONE_PENDING_APPROVAL = 'done_pending_approval',
  CANCELED = 'canceled',
}

export const SUPER_STATUS_ORDER: JobSuperStatus[] = [
  JobSuperStatus.SUBMITTED,
  JobSuperStatus.IN_PROGRESS,
  JobSuperStatus.DONE,
  JobSuperStatus.PENDING,
  JobSuperStatus.DONE_PENDING_APPROVAL,
  JobSuperStatus.CANCELED,
];

/** Super-statuses a deal can't be moved *out of* by ordinary work. */
export const TERMINAL_SUPER_STATUSES = new Set<JobSuperStatus>([
  JobSuperStatus.DONE,
  JobSuperStatus.DONE_PENDING_APPROVAL,
  JobSuperStatus.CANCELED,
]);

/**
 * Super-statuses that count as "closed" — the job is finished or dropped.
 * Reaching one stamps the deal's closedAt; done_pending_approval is not here,
 * it's still awaiting sign-off.
 */
export const CLOSED_SUPER_STATUSES = new Set<JobSuperStatus>([
  JobSuperStatus.DONE,
  JobSuperStatus.CANCELED,
]);

/**
 * Maps every legacy 13-stage value onto its super-status. Used both to backfill
 * existing deals and to derive `superStatus` on read for rows not yet migrated.
 * Note: `done_pending_approval` is a brand-new option with no legacy analogue.
 */
export const STAGE_TO_SUPER_STATUS: Record<DealStage, JobSuperStatus> = {
  [DealStage.NEW_LEAD]: JobSuperStatus.SUBMITTED,
  [DealStage.ESTIMATE_SENT]: JobSuperStatus.SUBMITTED,
  [DealStage.APPROVED]: JobSuperStatus.SUBMITTED,
  [DealStage.ASSIGNED]: JobSuperStatus.IN_PROGRESS,
  [DealStage.EN_ROUTE]: JobSuperStatus.IN_PROGRESS,
  [DealStage.ON_SITE]: JobSuperStatus.IN_PROGRESS,
  [DealStage.WORK_IN_PROGRESS]: JobSuperStatus.IN_PROGRESS,
  [DealStage.PENDING_PAYMENT]: JobSuperStatus.PENDING,
  [DealStage.PENDING_PARTS]: JobSuperStatus.PENDING,
  [DealStage.FOLLOW_UP]: JobSuperStatus.PENDING,
  [DealStage.ON_HOLD]: JobSuperStatus.PENDING,
  [DealStage.COMPLETED]: JobSuperStatus.DONE,
  [DealStage.CANCELED]: JobSuperStatus.CANCELED,
};
