"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";

/* --------------------------------------------------------------- queries */

/**
 * The job-source catalog. Read on nearly every deal/dispatch/technician screen to
 * resolve ids to names, so it's cached generously — the catalog changes rarely.
 */
export function useJobSources() {
  return useQuery({
    queryKey: queryKeys.jobSources.list(),
    queryFn: api.listJobSources,
    staleTime: 5 * 60_000,
  });
}

export function useJobSource(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.jobSources.detail(id),
    queryFn: () => api.getJobSource(id),
    enabled,
  });
}

/* ------------------------------------------------------------- mutations */

function useInvalidateJobSources() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.jobSources.all() });
}

export function useCreateJobSource() {
  const invalidate = useInvalidateJobSources();
  return useMutation({
    mutationFn: (body: unknown) => api.createJobSource(body),
    onSuccess: () => {
      invalidate();
      toast.success("Job source created");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateJobSource(id: string) {
  const invalidate = useInvalidateJobSources();
  return useMutation({
    mutationFn: (body: unknown) => api.updateJobSource(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Job source updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteJobSource() {
  const invalidate = useInvalidateJobSources();
  return useMutation({
    mutationFn: (id: string) => api.deleteJobSource(id),
    onSuccess: (res) => {
      invalidate();
      // The backend archives a type still in use rather than deleting it.
      toast.success(res.archived ? "Job source archived (still in use)" : "Job source deleted");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
