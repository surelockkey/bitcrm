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
