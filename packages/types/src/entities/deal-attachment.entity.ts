/** A file (photo or document) attached to a job/deal. */
export interface DealAttachment {
  dealId: string;
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
