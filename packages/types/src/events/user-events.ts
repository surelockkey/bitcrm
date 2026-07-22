/**
 * Canonical contract for events published on the `user-events` SNS topic.
 * Publishers (user-service) and consumers (deal-service, inventory-service)
 * import these so the wire format can't drift.
 */
export const USER_EVENT_TOPIC = 'user-events' as const;

export const UserEventType = {
  USER_ACTIVATED: 'user.activated',
  USER_ROLE_CHANGED: 'user.role-changed',
  USER_INVITE_RESENT: 'user.invite-resent',
  TECH_UPDATED: 'tech.updated',
  TECH_APPROVED: 'tech.approved',
  COMMISSION_UPDATED: 'commission.updated',
  DOCUMENT_UPLOADED: 'document.uploaded',
  DOCUMENT_ACCESSED: 'document.accessed',
  DOCUMENT_DELETED: 'document.deleted',
  SENSITIVE_ACCESSED: 'sensitive.accessed',
} as const;

export type UserEventType = (typeof UserEventType)[keyof typeof UserEventType];

// --- Payloads ---

export interface UserActivatedEvent {
  userId: string;
  roleId: string;
  department: string;
  firstName: string;
  lastName: string;
}
export type UserRoleChangedEvent = UserActivatedEvent;
export type UserInviteResentEvent = UserActivatedEvent;

export interface TechUpdatedEvent {
  technicianId: string;
  changedFields: string[];
}

export interface TechApprovedEvent {
  technicianId: string;
  /** Catalog job-type ids the technician is approved for. */
  jobTypeIds: string[];
  /** Catalog service-area ids the technician is approved for. */
  serviceAreaIds: string[];
}

export interface CommissionUpdatedEvent {
  technicianId: string;
  baseRatePct: number;
  effectiveDate: string;
}

export interface DocumentEvent {
  technicianId: string;
  docType: string;
  actorId?: string;
}

export interface SensitiveAccessedEvent {
  technicianId: string;
  actorId: string;
  full: boolean;
}
