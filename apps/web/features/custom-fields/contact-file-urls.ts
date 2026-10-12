"use client";

import { useQueries } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { getContactAttachmentDownloadUrl } from "@/features/deals/attachments-api";

/**
 * Presigned URLs for a client's own files — the thumbnails of a client file
 * field (Workiz's "Work Order" on the client page). The same cache entries the
 * Files rail reads (`contacts.fileUrl`), kept short of the URL's 300 s life.
 */
export function useContactFileUrls(contactId: string, attachmentIds: string[]) {
  return useQueries({
    queries: attachmentIds.map((id) => ({
      queryKey: queryKeys.contacts.fileUrl(contactId, id),
      queryFn: () => getContactAttachmentDownloadUrl(contactId, id),
      staleTime: 4 * 60_000,
      gcTime: 4 * 60_000,
      enabled: !!contactId,
    })),
  });
}
