"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { JobRulesSettings } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";

/** The account's job rules — "Update Job End Time" and whatever joins it. */
export function useJobRules() {
  return useQuery({
    queryKey: queryKeys.jobRules(),
    queryFn: api.getJobRules,
    staleTime: 5 * 60_000,
  });
}

export function useUpdateJobRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<JobRulesSettings>) => api.updateJobRules(body),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.jobRules(), data);
      toast.success("Account preferences saved");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
