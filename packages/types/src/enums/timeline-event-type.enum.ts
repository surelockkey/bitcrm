export enum TimelineEventType {
  CREATED = 'created',
  /** @deprecated superseded by STATUS_CHANGED; kept so old entries still render. */
  STAGE_CHANGED = 'stage_changed',
  STATUS_CHANGED = 'status_changed',
  FIELD_UPDATED = 'field_updated',
  NOTE_ADDED = 'note_added',
  TECH_ASSIGNED = 'tech_assigned',
  TECH_UNASSIGNED = 'tech_unassigned',
  PRODUCT_ADDED = 'product_added',
  PRODUCT_UPDATED = 'product_updated',
  PRODUCT_REMOVED = 'product_removed',
  /** A phone call was attached to this job. */
  CALL_LINKED = 'call_linked',
  CALL_UNLINKED = 'call_unlinked',
  /**
   * The technician flow, as the old CRM logged it: "Confirmed job receipt"
   * (the tech acknowledged the assignment on their phone) and "Arrived at
   * location". Written by the technician endpoints; dispatch reads them on
   * the job's activity feed like any other event.
   */
  TECH_CONFIRMED = 'tech_confirmed',
  TECH_ARRIVED = 'tech_arrived',
  /** A photo/file appeared on, was renamed on, or vanished from the job. */
  ATTACHMENT_ADDED = 'attachment_added',
  ATTACHMENT_RENAMED = 'attachment_renamed',
  ATTACHMENT_REMOVED = 'attachment_removed',
  /** Workiz "Sent to tech by SMS / In App / Email": a dispatcher handed the job to the roster. */
  SENT_TO_TECH = 'sent_to_tech',
  /** Workiz "Viewed job in app": an assigned technician opened the job. */
  SEEN_BY_TECH = 'seen_by_tech',
}
