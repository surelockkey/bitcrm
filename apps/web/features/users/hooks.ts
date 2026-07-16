"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { CreateUserRequest, UpdateUserRequest } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
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

function useInvalidateUsers() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.users.all() });
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
