"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api/errors";
import { queryKeys } from "@/lib/query-keys";
import { usePermissions } from "@/features/auth/use-permissions";
import * as api from "./api";

/** The Automation Center is part of workspace settings. */
export function useAutomationsAccess() {
  const { can, isLoading } = usePermissions();
  return { isLoading, canView: can("settings", "view"), canEdit: can("settings", "edit") };
}

export function useAutomations(enabled = true) {
  return useQuery({
    queryKey: queryKeys.automations.list(),
    queryFn: api.listAutomations,
    enabled,
    staleTime: 30_000,
  });
}

/** A rule's last firings — only read while the drawer showing them is open. */
export function useAutomationRuns(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.automations.runs(id ?? ""),
    queryFn: () => api.listAutomationRuns(id as string),
    enabled: !!id && enabled,
  });
}

function useInvalidateAutomations() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.automations.all() });
}

export function useUpdateAutomation() {
  const invalidate = useInvalidateAutomations();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: api.UpdateAutomationBody }) => api.updateAutomation(id, body),
    onSuccess: (rule, { body }) => {
      invalidate();
      if (body.enabled !== undefined) toast.success(body.enabled ? `${rule.name} is on` : `${rule.name} is off`);
      else toast.success(`${rule.name} saved`);
    },
    // A rule with nothing runnable answers 422 RULE_NOT_RUNNABLE with the reason.
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/** Test run — never invalidates anything: nothing was sent. */
export function useTestAutomation() {
  return useMutation({
    mutationFn: ({ id, dealId }: { id: string; dealId: string }) => api.testAutomation(id, dealId),
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useMigrateAutomations() {
  const invalidate = useInvalidateAutomations();
  return useMutation({
    mutationFn: (dryRun?: boolean) => api.migrateAutomations(dryRun),
    onSuccess: (result) => {
      invalidate();
      toast.success(`${result.runnable} of ${result.rules} imported rules can run here`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
