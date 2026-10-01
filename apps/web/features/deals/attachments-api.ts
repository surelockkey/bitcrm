import type { DealAttachmentMeta, PaginatedResponse } from "@bitcrm/types";
import { apiFetchPaginated, http } from "@/lib/api/http";

/** What the job's Files tab and the client's Files rail accept from the picker. */
export const ATTACHMENT_ACCEPT = "image/png,image/jpeg,image/webp,image/heic,application/pdf";

export interface AttachmentUploadTicket {
  id: string;
  uploadUrl: string;
  s3Key: string;
  headers?: Record<string, string>;
}

export interface AttachmentUploadBody {
  fileName: string;
  contentType: string;
  size?: number;
  category?: string;
}

export function listAttachments(dealId: string): Promise<DealAttachmentMeta[]> {
  return http.get<DealAttachmentMeta[]>(`/deals/${dealId}/attachments`);
}

export function requestAttachmentUpload(
  dealId: string,
  body: AttachmentUploadBody,
): Promise<AttachmentUploadTicket> {
  return http.post<AttachmentUploadTicket>(`/deals/${dealId}/attachments`, body);
}

export function updateAttachment(
  dealId: string,
  attachmentId: string,
  body: { fileName?: string; description?: string },
): Promise<DealAttachmentMeta> {
  return http.patch<DealAttachmentMeta>(`/deals/${dealId}/attachments/${attachmentId}`, body);
}

export function getAttachmentDownloadUrl(
  dealId: string,
  attachmentId: string,
): Promise<{ downloadUrl: string }> {
  return http.get<{ downloadUrl: string }>(`/deals/${dealId}/attachments/${attachmentId}`);
}

export function deleteAttachment(dealId: string, attachmentId: string): Promise<null> {
  return http.delete<null>(`/deals/${dealId}/attachments/${attachmentId}`);
}

export async function uploadAttachmentBytes(
  uploadUrl: string,
  file: File,
  headers?: Record<string, string>,
): Promise<void> {
  // The presigned URL is signed with SSE-KMS, so the encryption headers the
  // backend returns are part of the signature and MUST be replayed here — a PUT
  // with only Content-Type is rejected with a 403.
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: headers ?? { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) throw new Error("Attachment upload failed");
}

/** Request a ticket derived from the file, then push the bytes to S3. */
export async function uploadAttachment(
  dealId: string,
  file: File,
  category?: string,
): Promise<void> {
  const ticket = await requestAttachmentUpload(dealId, {
    fileName: file.name,
    contentType: file.type,
    size: file.size,
    category,
  });
  await uploadAttachmentBytes(ticket.uploadUrl, file, ticket.headers);
}

/* ------------------------------------------------- the client's files */

/**
 * One row of the client card's Files rail. With a `dealId` it is a job's
 * file (read through the job's routes, `deals.view`); without one it is the
 * client's own file (`/deals/contacts/:contactId/attachments`, `contacts.*`).
 */
export type ContactFileRow = DealAttachmentMeta & {
  contactId: string;
  dealId?: string;
  dealNumber?: string;
};

export const isJobFile = (row: ContactFileRow): row is ContactFileRow & { dealId: string } => !!row.dealId;

/** `GET /deals/attachments/by-contact/:contactId` — the client's and its jobs' files, newest first. */
export function listAttachmentsByContact(
  contactId: string,
  cursor?: string,
  limit = 60,
): Promise<PaginatedResponse<ContactFileRow>> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (cursor) q.set("cursor", cursor);
  return apiFetchPaginated<ContactFileRow>(`/deals/attachments/by-contact/${contactId}?${q}`);
}

export function requestContactAttachmentUpload(
  contactId: string,
  body: AttachmentUploadBody,
): Promise<AttachmentUploadTicket> {
  return http.post<AttachmentUploadTicket>(`/deals/contacts/${contactId}/attachments`, body);
}

export function getContactAttachmentDownloadUrl(
  contactId: string,
  attachmentId: string,
): Promise<{ downloadUrl: string }> {
  return http.get<{ downloadUrl: string }>(`/deals/contacts/${contactId}/attachments/${attachmentId}`);
}

export function updateContactAttachment(
  contactId: string,
  attachmentId: string,
  body: { fileName?: string; description?: string },
): Promise<DealAttachmentMeta> {
  return http.patch<DealAttachmentMeta>(`/deals/contacts/${contactId}/attachments/${attachmentId}`, body);
}

export function deleteContactAttachment(contactId: string, attachmentId: string): Promise<null> {
  return http.delete<null>(`/deals/contacts/${contactId}/attachments/${attachmentId}`);
}

/** The same presign + PUT flow as a job's file, on the client's own route. */
export async function uploadContactAttachment(contactId: string, file: File): Promise<void> {
  const ticket = await requestContactAttachmentUpload(contactId, {
    fileName: file.name,
    contentType: file.type,
    size: file.size,
  });
  await uploadAttachmentBytes(ticket.uploadUrl, file, ticket.headers);
}

/** A presigned URL for a rail row, whichever side it lives on. */
export function getFileDownloadUrl(row: ContactFileRow): Promise<{ downloadUrl: string }> {
  return isJobFile(row)
    ? getAttachmentDownloadUrl(row.dealId, row.id)
    : getContactAttachmentDownloadUrl(row.contactId, row.id);
}
