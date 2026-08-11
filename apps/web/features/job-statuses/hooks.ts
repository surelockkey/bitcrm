"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";

/* --------------------------------------------------------------- queries */

/**
 * The job-sub-status catalog. Read on the job page and Settings to resolve ids
 * to colored labels, so it's cached generously — the catalog changes rarely.
 */
export function useJobStatuses() {
  return useQuery({
    queryKey: queryKeys.jobStatuses.list(),
    queryFn: api.listJobStatuses,
    staleTime: 5 * 60_000,
  });
}

export function useJobStatus(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.jobStatuses.detail(id),
    queryFn: () => api.getJobStatus(id),
    enabled,
  });
}

/* ------------------------------------------------------------- mutations */

function useInvalidateJobStatuses() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.jobStatuses.all() });
}

export function useCreateJobStatus() {
  const invalidate = useInvalidateJobStatuses();
  return useMutation({
    mutationFn: (body: unknown) => api.createJobStatus(body),
    onSuccess: () => {
      invalidate();
      toast.success("Job status created");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateJobStatus(id: string) {
  const invalidate = useInvalidateJobStatuses();
  return useMutation({
    mutationFn: (body: unknown) => api.updateJobStatus(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Job status updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteJobStatus() {
  const invalidate = useInvalidateJobStatuses();
  return useMutation({
    mutationFn: (id: string) => api.deleteJobStatus(id),
    onSuccess: (res) => {
      invalidate();
      // The backend archives a status still in use rather than deleting it.
      toast.success(res.archived ? "Job status archived (still in use)" : "Job status deleted");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
