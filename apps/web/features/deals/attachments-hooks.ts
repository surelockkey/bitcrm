"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./attachments-api";

export function useAttachments(dealId: string) {
  return useQuery({
    queryKey: queryKeys.deals.attachments(dealId),
    queryFn: () => api.listAttachments(dealId),
  });
}

/**
 * Presigned download URL for one attachment (used as an <img> src for photo
 * thumbnails). The URL expires in 300s, so it's cached for less than that and
 * re-requested on the next render after expiry.
 */
export function useAttachmentUrl(dealId: string, attachmentId: string) {
  return useQuery({
    queryKey: queryKeys.deals.attachmentUrl(dealId, attachmentId),
    queryFn: () => api.getAttachmentDownloadUrl(dealId, attachmentId),
    staleTime: 4 * 60_000,
    gcTime: 4 * 60_000,
  });
}

export function useUploadAttachment(dealId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, category }: { file: File; category?: string }) =>
      api.uploadAttachment(dealId, file, category),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.deals.attachments(dealId) });
      toast.success("Attachment uploaded");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateAttachment(dealId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      attachmentId,
      body,
    }: {
      attachmentId: string;
      body: { fileName?: string; description?: string };
    }) => api.updateAttachment(dealId, attachmentId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.deals.attachments(dealId) });
      toast.success("Attachment updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteAttachment(dealId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) => api.deleteAttachment(dealId, attachmentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.deals.attachments(dealId) });
      toast.success("Attachment removed");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
