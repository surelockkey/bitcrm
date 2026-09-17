/**
 * The slice of the BitCRM domain a technician's phone works with.
 *
 * Every shape here is the backend's own: `@bitcrm/types` is a `file:` dependency
 * of this app, so a field the server renames or retypes breaks this build rather
 * than reaching a technician as `undefined`. Until the app moved into the
 * monorepo these declarations were hand-copied, and the copy had already drifted
 * — `priority` had decayed from a two-value enum to `string`, and `TimelineEntry`
 * disagreed with the server about whether `details` can be missing.
 *
 * What stays local is at the bottom: two response envelopes that no service
 * declares as an entity.
 */

import type { Deal as CrmDeal } from '@bitcrm/types';

export { JobSuperStatus } from '@bitcrm/types';

/* ------------------------------------------------- shared, used unchanged */

export type {
  Address,
  Contact,
  DealAttachmentMeta,
  TimelineEntry,
} from '@bitcrm/types';

/* ------------------------------------------------------ shared, narrowed */

/**
 * What a job is, before anything has happened to it. The list screen cannot
 * draw a card without these, and every endpoint the app calls returns them.
 */
type JobIdentity = 'id' | 'dealNumber' | 'contactId' | 'address' | 'superStatus';

/**
 * Fields that are genuinely absent on a real job: dispatch has not dated it
 * yet, nobody has arrived, the workspace uses no sub-statuses.
 */
type JobWhenSet =
  | 'companyId'
  | 'scheduledDate'
  | 'scheduledTimeSlot'
  | 'allDay'
  | 'sequences'
  | 'notes'
  | 'subStatusId'
  | 'clientName'
  | 'techConfirmedAt'
  | 'techConfirmedBy'
  | 'arrivedAt'
  | 'arrivedBy'
  | 'arrivedLocation'
  | 'closedAt'
  | 'statusChangedAt';

/**
 * Fields `deals.repository.ts#toDeal` always sends (several with a `|| []`
 * default), which the phone still reads as optional. A job reaches a screen
 * from three directions — a fresh fetch, the persisted react-query cache that
 * a build one release older wrote, and an optimistic patch — and only the first
 * carries the server's guarantee. Requiring them here would make an older
 * cached row a type error at call sites that only ever read them.
 */
type JobServerFilled =
  | 'serviceArea'
  | 'assignedTechIds'
  | 'priority'
  | 'createdAt'
  | 'updatedAt';

export type Deal = Pick<CrmDeal, JobIdentity> &
  Partial<Pick<CrmDeal, JobWhenSet | JobServerFilled>>;

/* ----------------------------------------------------------- phone-only */

/**
 * What `POST /deals/:id/attachments` hands back. A response envelope rather
 * than an entity: no service stores one, so `@bitcrm/types` has nothing to
 * import here.
 */
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

/** What the server hands back after preparing a masked call. */
export interface StartedBridge {
  bridgeId: string;
  mode: 'softphone' | 'cell';
  callSid?: string;
  /** The client's NAME. Their number never leaves the server. */
  clientName?: string;
}
