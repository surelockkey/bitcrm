"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./call-groups-api";

export function useCallGroups(enabled = true) {
  return useQuery({
    queryKey: queryKeys.telephony.callGroups(),
    queryFn: api.listCallGroups,
    enabled,
  });
}

function useInvalidateCallGroups() {
  const qc = useQueryClient();
  return () =>
    qc.invalidateQueries({ queryKey: queryKeys.telephony.callGroups() });
}

export function useCreateCallGroup() {
  const invalidate = useInvalidateCallGroups();
  return useMutation({
    mutationFn: (body: api.CreateCallGroupValues) => api.createCallGroup(body),
    onSuccess: (group) => {
      invalidate();
      toast.success(`Created ${group.name}`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateCallGroup(id: string) {
  const invalidate = useInvalidateCallGroups();
  return useMutation({
    mutationFn: (body: api.UpdateCallGroupValues) => api.updateCallGroup(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Group saved");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/**
 * Membership is replaced wholesale, so the editor can add, remove and reorder
 * before one save — and a rejected save leaves the stored group untouched.
 */
export function useSetCallGroupMembers(id: string) {
  const invalidate = useInvalidateCallGroups();
  return useMutation({
    mutationFn: (members: Parameters<typeof api.setCallGroupMembers>[1]) =>
      api.setCallGroupMembers(id, members),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteCallGroup() {
  const invalidate = useInvalidateCallGroups();
  return useMutation({
    mutationFn: (id: string) => api.deleteCallGroup(id),
    onSuccess: () => {
      invalidate();
      toast.success("Group deleted");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
