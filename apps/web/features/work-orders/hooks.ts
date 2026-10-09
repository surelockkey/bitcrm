"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { WorkOrderStatus } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { ApiError, getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";
import type { WorkOrderFormValues } from "./schemas";

export function useWorkOrders(params: { companyId?: string; status?: WorkOrderStatus } = {}, enabled = true) {
  return useQuery({
    queryKey: queryKeys.workOrders.list(params),
    queryFn: () => api.listWorkOrders(params),
    enabled,
  });
}

/** One work order — its own view. A 404 is an answer (`null`: no such work order), not an error. */
export function useWorkOrder(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.workOrders.detail(id),
    queryFn: () =>
      api.getWorkOrder(id).catch((e) => {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }),
    enabled: enabled && !!id,
  });
}

/**
 * The uploaded WO document's link (five minutes, so asked again after four).
 * `null` when there is none — and on an API from before the endpoint, whose
 * 404 reads the same: the paper alone, no frame for a file.
 */
export function useWorkOrderDocument(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.workOrders.document(id),
    queryFn: () =>
      api.getWorkOrderDocumentUrl(id).then(
        (r) => r.downloadUrl,
        (e) => {
          if (e instanceof ApiError && e.status === 404) return null;
          throw e;
        },
      ),
    enabled: enabled && !!id,
    staleTime: 4 * 60_000,
    refetchOnWindowFocus: false,
  });
}

function useInvalidateWorkOrders() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.workOrders.all() });
}

export function useCreateWorkOrder() {
  const invalidate = useInvalidateWorkOrders();
  return useMutation({
    mutationFn: (body: WorkOrderFormValues) => api.createWorkOrder(body),
    onSuccess: () => {
      invalidate();
      toast.success("Work order created");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteWorkOrder() {
  const invalidate = useInvalidateWorkOrders();
  return useMutation({
    mutationFn: (id: string) => api.deleteWorkOrder(id),
    onSuccess: ({ archived }) => {
      invalidate();
      toast.success(archived ? "Work order archived" : "Work order deleted");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/** "Upload file": a presigned PUT straight to S3, then the work order (and its link) read again. */
export function useUploadWorkOrderDocument() {
  const invalidate = useInvalidateWorkOrders();
  return useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const { uploadUrl, headers } = await api.getWorkOrderDocumentUploadUrl(id, file.type || "application/pdf");
      await api.uploadWorkOrderDocumentBytes(uploadUrl, file, headers);
    },
    onSuccess: () => {
      invalidate();
      toast.success("Work order file uploaded");
    },
    onError: (e) => toast.error(getApiErrorMessage(e, "Couldn't upload the file")),
  });
}
