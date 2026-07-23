/** An access-audit record for sensitive technician data (documents / fields). */
export interface AuditEntry {
  /** Subject — whose data was accessed. */
  userId: string;
  /** Actor — who accessed it. */
  actorId: string;
  /** e.g. 'document.viewed', 'document.uploaded', 'sensitive.read'. */
  action: string;
  /** Target resource, e.g. the docType or field name. */
  resource: string;
  timestamp: string;
}

/**
 * Read shape of the audit trail: actor display name resolved server-side,
 * because viewers (e.g. the technician themselves) may lack `users.view`.
 * Absent when the actor is unknown (deleted user, legacy row with no actor).
 */
export interface AuditEntryWithActor extends AuditEntry {
  actorName?: string;
}
