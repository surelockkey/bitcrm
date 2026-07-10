"use client";

import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { CreateRoleRequest, UpdateRoleRequest } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";

export function useRoles() {
  return useQuery({
    queryKey: queryKeys.roles.list(),
    queryFn: api.listRoles,
    staleTime: 5 * 60 * 1000,
  });
}

export function useRole(id: string) {
  return useQuery({
    queryKey: queryKeys.roles.detail(id),
    queryFn: () => api.getRole(id),
  });
}

/** The permission catalog rarely changes — cache it hard. */
export function useRoleSchema() {
  return useQuery({
    queryKey: queryKeys.roles.schema(),
    queryFn: api.getRoleSchema,
    staleTime: Infinity,
  });
}

export function useRoleMembers(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.roles.members(id),
    queryFn: () => api.listRoleMembers(id),
    enabled,
  });
}

/**
 * Assigned-user counts for a set of roles, fetched in parallel and cached under
 * the same key the editor's Members tab uses (so it's shared, not re-fetched).
 * Returns a map of roleId → count (undefined while loading).
 */
export function useRoleMemberCounts(ids: string[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: queryKeys.roles.members(id),
      queryFn: () => api.listRoleMembers(id),
      staleTime: 60 * 1000,
    })),
    combine: (results) => {
      const counts: Record<string, number | undefined> = {};
      ids.forEach((id, i) => {
        counts[id] = results[i].data?.length;
      });
      return counts;
    },
  });
}

function useInvalidateRoles() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.roles.all() });
}

export function useCreateRole() {
  const invalidate = useInvalidateRoles();
  return useMutation({
    mutationFn: (body: CreateRoleRequest) => api.createRole(body),
    onSuccess: (role) => {
      invalidate();
      toast.success(`Role “${role.name}” created`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateRoleRequest }) =>
      api.updateRole(id, body),
    onSuccess: (role) => {
      qc.invalidateQueries({ queryKey: queryKeys.roles.all() });
      // A role change re-resolves permissions server-side for its members.
      qc.invalidateQueries({ queryKey: queryKeys.users.all() });
      toast.success(`Saved changes to “${role.name}”`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteRole() {
  const invalidate = useInvalidateRoles();
  return useMutation({
    mutationFn: (id: string) => api.deleteRole(id),
    onSuccess: () => {
      invalidate();
      toast.success("Role deleted");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
