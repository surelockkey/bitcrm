"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";

/* --------------------------------------------------------------- queries */

/**
 * The job-type catalog. Read on nearly every deal/dispatch/technician screen to
 * resolve ids to names, so it's cached generously — the catalog changes rarely.
 */
export function useJobTypes() {
  return useQuery({
    queryKey: queryKeys.jobTypes.list(),
    queryFn: api.listJobTypes,
    staleTime: 5 * 60_000,
  });
}

export function useJobType(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.jobTypes.detail(id),
    queryFn: () => api.getJobType(id),
    enabled,
  });
}

/* ------------------------------------------------------------- mutations */

function useInvalidateJobTypes() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.jobTypes.all() });
}

export function useCreateJobType() {
  const invalidate = useInvalidateJobTypes();
  return useMutation({
    mutationFn: (body: unknown) => api.createJobType(body),
    onSuccess: () => {
      invalidate();
      toast.success("Job type created");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateJobType(id: string) {
  const invalidate = useInvalidateJobTypes();
  return useMutation({
    mutationFn: (body: unknown) => api.updateJobType(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Job type updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteJobType() {
  const invalidate = useInvalidateJobTypes();
  return useMutation({
    mutationFn: (id: string) => api.deleteJobType(id),
    onSuccess: (res) => {
      invalidate();
      // The backend archives a type still in use rather than deleting it.
      toast.success(res.archived ? "Job type archived (still in use)" : "Job type deleted");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
