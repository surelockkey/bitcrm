/**
 * What an admin did to a person or a role — the trail behind Admin → Users and
 * Roles (`GET /api/users/audit`). Written by user-service after the action
 * succeeded; never edited, never deleted.
 */
export const ADMIN_AUDIT_ACTIONS = [
  'user.created',
  'user.updated',
  'user.deactivated',
  'user.reactivated',
  'user.type_changed',
  'user.role_changed',
  'user.permissions_set',
  'user.permissions_cleared',
  'user.invite_resent',
  'user.mfa_changed',
  'role.created',
  'role.updated',
  'role.deleted',
] as const;
export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

export type AdminAuditTargetType = 'user' | 'role';

/** One field's move. Absent `from` = it was not set; absent `to` = it was removed. */
export interface AdminAuditChange {
  from?: unknown;
  to?: unknown;
}

export interface AdminAuditEntry {
  id: string;
  /** ISO instant the action completed. */
  at: string;
  action: AdminAuditAction;
  actorId: string;
  actorEmail?: string;
  actorRoleId?: string;
  targetType: AdminAuditTargetType;
  targetId: string;
  /** The person's name / email or the role's name, as it was then. */
  targetLabel?: string;
  /** Field → before/after; nested fields are dotted (`permissions.contacts.view_numbers`). */
  changes?: Record<string, AdminAuditChange>;
  /** The request's trace id — joins the entry to its log lines. */
  traceId?: string;
}
