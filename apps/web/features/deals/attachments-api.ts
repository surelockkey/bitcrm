import type { DealAttachmentMeta } from "@bitcrm/types";
import { http } from "@/lib/api/http";

export interface AttachmentUploadTicket {
  id: string;
  uploadUrl: string;
  s3Key: string;
  headers?: Record<string, string>;
}

export function listAttachments(dealId: string): Promise<DealAttachmentMeta[]> {
  return http.get<DealAttachmentMeta[]>(`/deals/${dealId}/attachments`);
}

export function requestAttachmentUpload(
  dealId: string,
  body: { fileName: string; contentType: string; size?: number; category?: string },
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
