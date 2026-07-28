"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  CreateUserRequest,
  UpdateUserRequest,
  UserPermissionOverrides,
} from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useMe } from "@/features/auth/use-me";
import * as api from "./api";
import type { UserFilter } from "./api";

export function useUsers(filter: UserFilter) {
  return useInfiniteQuery({
    queryKey: queryKeys.users.list(filter),
    queryFn: ({ pageParam }) => api.listUsers(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
  });
}

export function useRoles() {
  return useQuery({
    queryKey: queryKeys.roles.list(),
    queryFn: api.listRoles,
    staleTime: 5 * 60 * 1000,
  });
}

export function useUser(id: string) {
  return useQuery({
    queryKey: queryKeys.users.detail(id),
    queryFn: () => api.getUser(id),
  });
}

export function useUserPermissions(id: string) {
  return useQuery({
    queryKey: queryKeys.users.permissions(id),
    queryFn: () => api.getUserPermissions(id),
  });
}

function useInvalidateUsers() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.users.all() });
}

/**
 * Overrides mutations also refresh `me` when the caller edits themselves —
 * the client-side gates merge `me.permissionOverrides` (backend currently
 * rejects self-edits, but the cache must not go stale if that ever changes).
 */
function useInvalidatePermissions() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  return (userId: string) => {
    // Prefix ["users"] covers the list, detail(id) and permissions(id) keys.
    qc.invalidateQueries({ queryKey: queryKeys.users.all() });
    if (userId === me?.id) qc.invalidateQueries({ queryKey: queryKeys.me() });
  };
}

export function useSetUserPermissions() {
  const invalidate = useInvalidatePermissions();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UserPermissionOverrides }) =>
      api.setUserPermissions(id, body),
    onSuccess: (_u, { id }) => {
      invalidate(id);
      toast.success("Permissions updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useClearUserPermissions() {
  const invalidate = useInvalidatePermissions();
  return useMutation({
    mutationFn: (id: string) => api.clearUserPermissions(id),
    onSuccess: (_u, id) => {
      invalidate(id);
      toast.success("Overrides cleared — role defaults restored");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useCreateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (body: CreateUserRequest) => api.createUser(body),
    onSuccess: (u) => {
      invalidate();
      toast.success(`Invite sent to ${u.email}`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateUserRequest }) =>
      api.updateUser(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Profile updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useAssignRole() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: ({ id, roleId }: { id: string; roleId: string }) =>
      api.assignRole(id, roleId),
    onSuccess: () => {
      invalidate();
      toast.success("Role updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useResendInvite() {
  return useMutation({
    mutationFn: (id: string) => api.resendInvite(id),
    onSuccess: () => toast.success("Invite re-sent"),
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeactivateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (id: string) => api.deactivateUser(id),
    onSuccess: () => {
      invalidate();
      toast.success("User deactivated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useReactivateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (id: string) => api.reactivateUser(id),
    onSuccess: () => {
      invalidate();
      toast.success("User reactivated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
