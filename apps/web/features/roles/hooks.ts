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
import { settled } from "@/lib/use-page-ready";
import * as api from "./api";

/**
 * `enabled` is for screens a technician can open: they hold no `roles.view`, so
 * firing the list anyway earns a 403 and leaves a failed query behind on a page
 * that only wanted to name their role.
 */
export function useRoles(enabled = true) {
  return useQuery({
    queryKey: queryKeys.roles.list(),
    queryFn: api.listRoles,
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

/** `enabled`: a page that learns the role id from another answer holds it until then. */
export function useRole(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.roles.detail(id),
    queryFn: () => api.getRole(id),
    enabled: enabled && !!id,
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

/**
 * `staleTime` as the counts below: the editor asks for the members up front
 * and its tabs read them a moment later — from the cache, not again.
 */
export function useRoleMembers(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.roles.members(id),
    queryFn: () => api.listRoleMembers(id),
    enabled,
    staleTime: 60 * 1000,
  });
}

/**
 * Assigned-user counts for a set of roles, fetched in parallel and cached under
 * the same key the editor's Members tab uses (so it's shared, not re-fetched).
 * `counts` maps roleId → count (undefined while loading); `ready` says every
 * one has answered (a failure counts), for a list that shows them all at once.
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
      return { counts, ready: results.every(settled) };
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
