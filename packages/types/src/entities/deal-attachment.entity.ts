/** A file (photo or document) attached to a job/deal. */
export interface DealAttachment {
  dealId: string;
  /**
   * The job's client when the file was uploaded — files the row in the deals
   * table's ContactActivityIndex (GSI10) under CONTACTFILE#<contactId>, so the
   * client card lists the files of all of the client's jobs. Absent on rows
   * written before the index existed until `backfill:contact-index` has run.
   */
  contactId?: string;
  id: string;
  fileName: string;
  contentType: string;
  size?: number;
  /** Optional grouping label, e.g. "before", "after", "parts", "check". */
  category?: string;
  /** Free-text note shown under the file name (editable after upload). */
  description?: string;
  s3Key: string;
  uploadedBy: string;
  uploadedAt: string;
}

/** Attachment metadata returned to clients — never exposes the S3 key. */
export interface DealAttachmentMeta {
  id: string;
  fileName: string;
  contentType: string;
  size?: number;
  category?: string;
  description?: string;
  uploadedBy: string;
  uploadedAt: string;
}

/**
 * A file uploaded on the client itself (Workiz's "Upload file" on the client
 * card), not on any job: `CONTACT#<contactId>` / `ATTACH#<id>` in the deals
 * table, object `contacts/<contactId>/attachments/<id>`.
 */
export interface ContactAttachment {
  contactId: string;
  id: string;
  fileName: string;
  contentType: string;
  size?: number;
  category?: string;
  description?: string;
  s3Key: string;
  uploadedBy: string;
  uploadedAt: string;
}

/**
 * A row of the client card's Files (`GET /deals/attachments/by-contact/:id`).
 * `dealId` present → a job's file: download it through
 * `GET /deals/:dealId/attachments/:id`, and show "Job: <dealNumber>". Absent →
 * the client's own file: `GET /deals/contacts/:contactId/attachments/:id`.
 */
export interface ContactFileListItem extends DealAttachmentMeta {
  contactId: string;
  dealId?: string;
  dealNumber?: string;
}
