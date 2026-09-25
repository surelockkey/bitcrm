"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

/**
 * The workspace-wide firing feed — every rule, newest first, a page at a
 * time. A page narrowed by `outcome` can come back short of `limit` and
 * still have a cursor, so the end of the feed is `nextCursor`, never a
 * page that looks small.
 */
/**
 * Скільки всього рядків під тими самими фільтрами — з цього панель робить
 * «Page 2 of 7». Сервер тримає число тридцять секунд, тож і тут стільки ж.
 */
export function useAutomationRunsFeedCount(
  params: Omit<api.AutomationRunsFeedParams, "cursor" | "limit"> = {},
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.automations.runsCount(params),
    queryFn: () => api.countAutomationRunsFeed(params),
    staleTime: 30_000,
    enabled,
  });
}

export function useAutomationRunsFeed(params: api.AutomationRunsFeedParams = {}, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.automations.runsFeed(params),
    queryFn: ({ pageParam }) => api.listAutomationRunsFeed({ ...params, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

function useInvalidateAutomations() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.automations.all() });
}

export function useCreateAutomation() {
  const invalidate = useInvalidateAutomations();
  return useMutation({
    mutationFn: (body: api.CreateAutomationBody) => api.createAutomation(body),
    onSuccess: (rule) => {
      invalidate();
      toast.success(`${rule.name} created`);
    },
    // A spec the engine cannot run answers 422 with the reason.
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteAutomation() {
  const invalidate = useInvalidateAutomations();
  return useMutation({
    mutationFn: (id: string) => api.deleteAutomation(id),
    onSuccess: () => {
      invalidate();
      toast.success("Rule deleted");
    },
    // A built-in rule answers 422 RULE_BUILTIN — it is turned off, not deleted.
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDuplicateAutomation() {
  const invalidate = useInvalidateAutomations();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name?: string }) => api.duplicateAutomation(id, name),
    onSuccess: (rule) => {
      invalidate();
      toast.success(`${rule.name} created`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
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
