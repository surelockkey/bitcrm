import { http } from '../../lib/api/http';
import type {
  AttachmentUploadTicket,
  Deal,
  DealAttachmentMeta,
  JobSuperStatus,
  TimelineEntry,
} from './types';

/** The server caps `limit` at 100 (`ListDealsQueryDto`). Ask for all of it. */
const PAGE = 100;

export interface ListDealsParams {
  techId?: string;
  superStatus?: JobSuperStatus;
  cursor?: string;
}

function listDealsPath({ techId, superStatus, cursor }: ListDealsParams): string {
  const q = new URLSearchParams({ limit: String(PAGE) });
  if (techId) q.set('techId', techId);
  if (superStatus) q.set('superStatus', superStatus);
  if (cursor) q.set('cursor', cursor);
  return `/deals?${q.toString()}`;
}

/**
 * Walk every page of a technician's jobs.
 *
 * `GET /deals` has **no date filter** — `ListDealsQueryDto` carries no date
 * fields at all, and the technician index is sorted by `scheduledDate`
 * descending (docs/ARCHITECTURE.md §1.2). So "my jobs today" is assembled on
 * the phone from the whole assigned set, exactly as the web does in
 * `features/deals/api.ts:49-65`.
 *
 * A page can come back empty while a cursor still exists (the scan skipped a
 * segment), so the loop ends on the cursor, never on an empty page.
 */
export async function fetchAllDeals(
  params: Omit<ListDealsParams, 'cursor'> = {},
  { maxPages = 50 }: { maxPages?: number } = {},
): Promise<Deal[]> {
  const out: Deal[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await http.paginated<Deal>(listDealsPath({ ...params, cursor }));
    out.push(...page.data);
    cursor = page.pagination.nextCursor;
    pages += 1;
    // A server that never stops handing back cursors must not spin a phone's
    // battery flat; 50 pages is 5,000 jobs, far past any real technician.
  } while (cursor && pages < maxPages);
  return out;
}

export const getDeal = (id: string): Promise<Deal> => http.get<Deal>(`/deals/${id}`);

/* ----------------------------------------------------------------- status */

export interface MoveStatusBody {
  superStatus: JobSuperStatus;
  subStatusId?: string;
  /** Required by the server when moving to `canceled`. */
  cancellationReason?: string;
}

export const moveStatus = (id: string, body: MoveStatusBody): Promise<Deal> =>
  http.put<Deal>(`/deals/${id}/status`, body);

/* ------------------------------------------------------- technician flow */

/**
 * "I've got it". Idempotent per caller: a second tap keeps the first stamp and
 * writes no second timeline entry, which is what makes it safe to replay from
 * the offline queue.
 */
export const confirmJobReceipt = (id: string): Promise<Deal> =>
  http.post<Deal>(`/deals/${id}/tech/confirm`, {});

export interface MarkArrivedBody {
  lat?: number;
  lng?: number;
  /** Metres. The server rejects anything over 100,000. */
  accuracy?: number;
  /** Omitted, the server applies the workspace's own arrival sub-status. */
  subStatusId?: string;
}

/** "I'm here", with the phone's fix when it offered one. Also idempotent. */
export const markArrived = (id: string, body: MarkArrivedBody = {}): Promise<Deal> =>
  http.post<Deal>(`/deals/${id}/tech/arrived`, body);

/* --------------------------------------------------------------- timeline */

export const getTimeline = (id: string) =>
  http.paginated<TimelineEntry>(`/deals/${id}/timeline`);

export const addNote = (id: string, note: string): Promise<{ added: true }> =>
  http.post<{ added: true }>(`/deals/${id}/notes`, { note });

/* ------------------------------------------------------------ attachments */

export interface RequestUploadBody {
  fileName: string;
  /** image/jpeg | image/png | image/webp | image/heic | application/pdf. */
  contentType: string;
  size?: number;
  category?: string;
}

/**
 * Ask for a presigned PUT.
 *
 * Careful: this call **already writes the attachment's metadata and an
 * ATTACHMENT_ADDED timeline entry** (deal-attachments.service.ts:72-90). A
 * ticket that is never PUT leaves a ghost on the job, which is why the upload
 * queue asks for it lazily — at the moment it is about to send the bytes
 * (docs/ARCHITECTURE.md §1.3, §2.4).
 */
export const requestAttachmentUpload = (
  id: string,
  body: RequestUploadBody,
): Promise<AttachmentUploadTicket> =>
  http.post<AttachmentUploadTicket>(`/deals/${id}/attachments`, body);

export const listAttachments = (id: string): Promise<DealAttachmentMeta[]> =>
  http.get<DealAttachmentMeta[]>(`/deals/${id}/attachments`);

export const getAttachmentDownloadUrl = (
  id: string,
  attachmentId: string,
): Promise<{ url: string }> =>
  http.get<{ url: string }>(`/deals/${id}/attachments/${attachmentId}`);
