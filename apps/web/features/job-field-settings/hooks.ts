"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { JobFieldSettings } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";

/** Which job fields are required — read by the New Job form for asterisks. */
export function useJobFieldSettings() {
  return useQuery({
    queryKey: queryKeys.jobFieldSettings(),
    queryFn: api.getJobFieldSettings,
    staleTime: 5 * 60_000,
  });
}

export function useUpdateJobFieldSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: JobFieldSettings) => api.updateJobFieldSettings(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.jobFieldSettings() });
      toast.success("Job field settings saved");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
