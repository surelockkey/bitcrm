"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";

/* --------------------------------------------------------------- queries */

/**
 * The call-tag catalog. Read by every chip in the call log to resolve ids to
 * names, so it is cached generously — a workspace has tens of call tags
 * (Workiz: 28) and they change about once a quarter.
 *
 * `enabled` lets a caller skip the request when the viewer cannot read the
 * catalog at all (the route is behind `settings.view`), rather than firing a
 * request that is certain to 403.
 */
export function useCallTags(enabled = true) {
  return useQuery({
    queryKey: queryKeys.callTags.list(),
    queryFn: api.listCallTags,
    staleTime: 5 * 60_000,
    enabled,
  });
}

/* ------------------------------------------------------------- mutations */

function useInvalidateCallTags() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.callTags.all() });
}

export function useCreateCallTag() {
  const invalidate = useInvalidateCallTags();
  return useMutation({
    mutationFn: (body: api.CallTagValues) => api.createCallTag(body),
    onSuccess: (tag) => {
      invalidate();
      toast.success(`Created ${tag.name}`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateCallTag(id: string) {
  const invalidate = useInvalidateCallTags();
  return useMutation({
    mutationFn: (body: Partial<api.CallTagValues>) => api.updateCallTag(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Call tag saved");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/**
 * Archive a call tag. There is no delete: the call log is far too large to
 * check for references, so the tag leaves the pickers and keeps naming the
 * calls that already carry it.
 */
export function useArchiveCallTag() {
  const invalidate = useInvalidateCallTags();
  return useMutation({
    mutationFn: (id: string) => api.archiveCallTag(id),
    onSuccess: () => {
      invalidate();
      toast.success("Call tag archived — old calls keep their label");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/** Bring an archived tag back into the pickers. */
export function useRestoreCallTag() {
  const invalidate = useInvalidateCallTags();
  return useMutation({
    mutationFn: (id: string) => api.updateCallTag(id, { active: true }),
    onSuccess: (tag) => {
      invalidate();
      toast.success(`${tag.name} restored`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
