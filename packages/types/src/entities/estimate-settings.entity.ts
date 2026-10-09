/**
 * Settings → Estimates (Workiz `/root/estimatesSettings`): the two switches of
 * that page we act on. A singleton in the billing table; reads fall back to
 * `DEFAULT_ESTIMATE_SETTINGS` — the account's own Workiz values
 * (`include_pdf: 1`, `auto_decline_same_job: 1`) — until one is saved.
 */
export interface EstimateSettings {
  /**
   * "Attach PDF files — Send your clients PDF copy of estimates": an email
   * sent from the Send panel carries the rendered PDF beside the portal
   * link. Applies to invoices sent the same way.
   */
  attachPdf: boolean;
  /**
   * "Auto-decline estimates related to the same job": approving one of a
   * job's estimates declines the job's other open ones (unsent / pending).
   */
  autoDeclineSameJob: boolean;
  updatedBy?: string;
  updatedAt?: string;
}

export const DEFAULT_ESTIMATE_SETTINGS: EstimateSettings = {
  attachPdf: true,
  autoDeclineSameJob: true,
};

/**
 * What the Send panel adds to an email's `attachments[]` (messaging's
 * `SendAttachmentDto`): the document's PDF, already uploaded through
 * messaging's presign on the caller's bearer. `warning` says why there is no
 * PDF when the switch is on but the file could not be made — the email still
 * goes out with the portal link.
 */
export interface DocumentEmailAttachment {
  id: string;
  fileName: string;
  contentType: 'application/pdf';
  size: number;
}

export interface DocumentEmailAttachments {
  attachments: DocumentEmailAttachment[];
  warning?: string;
}
