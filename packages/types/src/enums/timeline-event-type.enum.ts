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
  /** A photo/file appeared on, was renamed on, or vanished from the job. */
  ATTACHMENT_ADDED = 'attachment_added',
  ATTACHMENT_RENAMED = 'attachment_renamed',
  ATTACHMENT_REMOVED = 'attachment_removed',
  /** Job tax rate / discount / line taxable flag changed. */
  TAX_CHANGED = 'tax_changed',
  DISCOUNT_CHANGED = 'discount_changed',
  /** Billing documents (written by the billing service via deal's internal timeline endpoint). */
  INVOICE_CREATED = 'invoice_created',
  INVOICE_UPDATED = 'invoice_updated',
  INVOICE_SENT = 'invoice_sent',
  INVOICE_DELETED = 'invoice_deleted',
  ESTIMATE_CREATED = 'estimate_created',
  ESTIMATE_STATUS_CHANGED = 'estimate_status_changed',
  ESTIMATE_SENT = 'estimate_sent',
  ESTIMATE_SYNCED = 'estimate_synced',
  ESTIMATE_DELETED = 'estimate_deleted',
}
