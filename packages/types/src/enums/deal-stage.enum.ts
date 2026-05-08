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
