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

/**
 * `changedFields` markers. The consumer decides what each one costs it, so the
 * strings have to mean the same thing on both sides — user-service and
 * deal-service each kept their own copy of `'assignments'`.
 */
export const TechChangedField = {
  /** An approved job type or service area was granted, revoked or rejected. */
  ASSIGNMENTS: 'assignments',
  /** The user was moved into, or out of, the technician role. */
  ROLE: 'role',
  /** The account was deactivated or reactivated. */
  STATUS: 'status',
  /** The person was switched onto, or off, the field team. */
  FIELD_TEAM: 'fieldTeamMember',
} as const;

export type TechChangedField =
  (typeof TechChangedField)[keyof typeof TechChangedField];

/**
 * Whether a `tech.updated` can have moved someone in or out of dispatch.
 * Everything else about a technician — commission, documents, phone — leaves
 * eligibility alone and is not worth a round trip to re-read.
 */
export function affectsEligibility(changedFields?: string[]): boolean {
  const relevant: string[] = [
    TechChangedField.ASSIGNMENTS,
    TechChangedField.ROLE,
    TechChangedField.STATUS,
    TechChangedField.FIELD_TEAM,
  ];
  return Boolean(changedFields?.some((f) => relevant.includes(f)));
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
