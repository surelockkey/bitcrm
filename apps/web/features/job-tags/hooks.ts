"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";

/* --------------------------------------------------------------- queries */

/**
 * The job-tag catalog. Read on nearly every deal/dispatch/technician screen to
 * resolve ids to names, so it's cached generously — the catalog changes rarely.
 */
export function useJobTags() {
  return useQuery({
    queryKey: queryKeys.jobTags.list(),
    queryFn: api.listJobTags,
    staleTime: 5 * 60_000,
  });
}

export function useJobTag(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.jobTags.detail(id),
    queryFn: () => api.getJobTag(id),
    enabled,
  });
}

/* ------------------------------------------------------------- mutations */

function useInvalidateJobTags() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.jobTags.all() });
}

export function useCreateJobTag() {
  const invalidate = useInvalidateJobTags();
  return useMutation({
    mutationFn: (body: unknown) => api.createJobTag(body),
    onSuccess: () => {
      invalidate();
      toast.success("Job tag created");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateJobTag(id: string) {
  const invalidate = useInvalidateJobTags();
  return useMutation({
    mutationFn: (body: unknown) => api.updateJobTag(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Job tag updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteJobTag() {
  const invalidate = useInvalidateJobTags();
  return useMutation({
    mutationFn: (id: string) => api.deleteJobTag(id),
    onSuccess: (res) => {
      invalidate();
      // The backend archives a type still in use rather than deleting it.
      toast.success(res.archived ? "Job tag archived (still in use)" : "Job tag deleted");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
