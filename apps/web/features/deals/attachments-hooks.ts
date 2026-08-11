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
