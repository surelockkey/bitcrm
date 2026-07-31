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
  PRODUCT_REMOVED = 'product_removed',
}
