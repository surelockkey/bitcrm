/**
 * The slice of the BitCRM domain a technician's phone needs, mirrored from the
 * backend's `@bitcrm/types` package. Only the fields this app reads are listed;
 * anything else the server sends is carried through untouched.
 *
 * Source: `packages/types/src/entities/deal.entity.ts` and
 * `enums/deal-stage.enum.ts` on the `bitcrm-f-tech` branch.
 */

export interface Address {
  street: string;
  unit?: string;
  city: string;
  state: string;
  zip: string;
  lat?: number;
  lng?: number;
}

/**
 * The closed set of job statuses. Dispatchers add coloured *sub*-statuses under
 * these but can neither add nor remove the super-statuses themselves.
 */
export const JobSuperStatus = {
  SUBMITTED: 'submitted',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
  PENDING: 'pending',
  DONE_PENDING_APPROVAL: 'done_pending_approval',
  CANCELED: 'canceled',
} as const;

export type JobSuperStatus =
  (typeof JobSuperStatus)[keyof typeof JobSuperStatus];

export interface Deal {
  id: string;
  /** Human-facing Job ID, e.g. "K4T9ZW". */
  dealNumber: string;
  contactId: string;
  companyId?: string;
  /** YYYY-MM-DD. Absent on a job dispatch has not dated yet. */
  scheduledDate?: string;
  /** "HH:MM-HH:MM". Absent when `allDay`. */
  scheduledTimeSlot?: string;
  allDay?: boolean;
  serviceArea?: string;
  address: Address;
  superStatus: JobSuperStatus;
  assignedTechIds?: string[];
  /** Per-technician visit order for the day: `techId → position`. */
  sequences?: Record<string, number>;
  priority?: string;
  notes?: string;
  subStatusId?: string;
  /** Per-job override of the client's display name. */
  clientName?: { firstName: string; lastName: string };
  /** When an assigned technician acknowledged the job from their phone. */
  techConfirmedAt?: string;
  techConfirmedBy?: string;
  /** When the technician tapped "Arrived", and the fix the phone offered. */
  arrivedAt?: string;
  arrivedBy?: string;
  arrivedLocation?: { lat: number; lng: number; accuracy?: number };
  closedAt?: string;
  statusChangedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TimelineEntry {
  id: string;
  dealId: string;
  eventType: string;
  actorId: string;
  actorName: string;
  timestamp: string;
  details?: Record<string, unknown>;
  note?: string;
}

/** Attachment metadata as returned to clients — never the S3 key. */
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

/** What `POST /deals/:id/attachments` hands back. */
export interface AttachmentUploadTicket {
  id: string;
  uploadUrl: string;
  s3Key: string;
  /**
   * SSE-KMS headers that are part of the presigned signature. They MUST be
   * replayed verbatim on the PUT or S3 answers 403
   * (deal-attachments.service.ts:65-70).
   */
  headers: Record<string, string>;
}

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  phones: string[];
  /** Set when the viewer lacks `contacts.view_numbers` — a technician has it. */
  phoneCount?: number;
  phonesMasked?: true;
  phoneExtensions?: Record<string, string>;
  emails?: string[];
  addresses?: Address[];
}

/** What the server hands back after preparing a masked call. */
export interface StartedBridge {
  bridgeId: string;
  mode: 'softphone' | 'cell';
  callSid?: string;
  /** The client's NAME. Their number never leaves the server. */
  clientName?: string;
}
