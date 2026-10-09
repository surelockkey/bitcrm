"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { UpdateSecuritySettingsRequest } from "@bitcrm/types";
import { getApiErrorMessage } from "@/lib/api/errors";
import { queryKeys } from "@/lib/query-keys";
import * as api from "./api";

/**
 * The account's security settings. Read by the Security Center page and by
 * My Profile (whose two-factor row reads "Required by your account" off
 * `requireMfa`); a page that shows either must prefetch it in its gate.
 */
export function useSecuritySettings(enabled = true) {
  return useQuery({
    queryKey: queryKeys.securitySettings(),
    queryFn: api.getSecuritySettings,
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** One switch at a time, saved the moment it is flipped (Workiz has no Save on this page). */
export function useUpdateSecuritySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateSecuritySettingsRequest) => api.updateSecuritySettings(body),
    onSuccess: (settings) => {
      qc.setQueryData(queryKeys.securitySettings(), settings);
      toast.success("Security settings saved");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
