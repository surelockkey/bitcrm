"use client";

import { useEffect, useMemo } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { DocumentType, User } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { ApiError } from "@/lib/api/errors";
import * as api from "./api";
import type {
  UpdateProfileBody,
  ProposeSkillsBody,
  SetCommissionBody,
  CalculateCommissionQuery,
  SetSensitiveBody,
} from "./api";

/* ---- Queries ---- */

export function useTechnicians(status?: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.technicians.list(status ?? "all"),
    queryFn: ({ pageParam }) => api.listTechnicians(status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
    enabled,
  });
}

/**
 * Every technician profile, cursor-drained.
 *
 * The dispatch map places technicians by their home coordinates, so it needs all
 * of them — reading only the first page would silently omit everyone past the
 * hundredth, and a missing marker looks like a technician with no work rather
 * than a paging bug. Reuses the same cache entry as `useTechnicians`.
 */
export function useAllTechnicians(enabled = true) {
  const query = useTechnicians(undefined, enabled);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const profiles = useMemo(
    () => query.data?.pages.flatMap((page) => page.data) ?? [],
    [query.data],
  );

  return {
    profiles,
    // Still draining — treat a partial list as "not ready" so the map doesn't
    // flash a half-populated technician layer.
    isLoading: query.isLoading || hasNextPage === true,
  };
}

/**
 * Live technician locations for the dispatch map. Polled, because a fix is only
 * good for a couple of minutes — the query refreshes faster than it expires so a
 * moving technician stays current.
 */
export function useTechnicianLocations(enabled = true) {
  return useQuery({
    queryKey: queryKeys.technicians.locations(),
    queryFn: () => api.listLocations(),
    enabled,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

/**
 * The cache entry is shared with `features/deals` under the same key, so it must
 * hold the raw User[]; the Map is derived per-observer. Module-level so React
 * Query can memoize it instead of rebuilding the Map every render.
 */
const toUserMap = (users: User[]) => new Map(users.map((u) => [u.id, u] as const));

/** id→User map for the name join (profiles store no name). Cached hard. */
export function useUserMap() {
  return useQuery({
    queryKey: queryKeys.technicians.userMap(),
    queryFn: () => api.fetchAllUsers(),
    staleTime: 5 * 60 * 1000,
    select: toUserMap,
  });
}

export function useProfile(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.technicians.profile(id),
    queryFn: () => api.getProfile(id),
    enabled: enabled && Boolean(id),
  });
}

export function useOnboarding(id: string) {
  return useQuery({
    queryKey: queryKeys.technicians.onboarding(id),
    queryFn: () => api.getOnboarding(id),
  });
}

export function useSkills(id: string) {
  return useQuery({
    queryKey: queryKeys.technicians.skills(id),
    queryFn: () => api.getSkills(id),
  });
}

export function usePendingSkills(enabled = true) {
  return useQuery({
    queryKey: queryKeys.technicians.pendingSkills(),
    queryFn: () => api.listPendingSkills(),
    enabled,
    staleTime: 30 * 1000,
  });
}

/** Latest commission config — 404 (never set) resolves to null, not an error. */
export function useCommission(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.technicians.commission(id),
    enabled,
    queryFn: () =>
      api.getCommission(id).catch((e) => {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }),
  });
}

export function useCommissionHistory(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.technicians.commissionHistory(id),
    enabled,
    queryFn: () => api.getCommissionHistory(id).catch((e) => {
      if (e instanceof ApiError && e.status === 404) return [];
      throw e;
    }),
  });
}

export function useCommissionCalc(id: string, q: CalculateCommissionQuery | null) {
  return useQuery({
    queryKey: queryKeys.technicians.commissionCalc(id, q),
    enabled: q !== null,
    queryFn: () => api.calculateCommission(id, q as CalculateCommissionQuery),
  });
}

export function useDocuments(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.technicians.documents(id),
    queryFn: () => api.listDocuments(id),
    enabled,
  });
}

export function useSensitive(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.technicians.sensitive(id),
    queryFn: () => api.getSensitive(id),
    enabled,
    staleTime: 0,
    gcTime: 0, // never cache PII
  });
}

export function useAudit(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.technicians.audit(id),
    queryFn: () => api.getAudit(id),
    enabled,
  });
}

/* ---- Mutations ---- */

function useInvalidateTechnicians() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.technicians.all() });
}

export function useUpdateProfile() {
  const invalidate = useInvalidateTechnicians();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateProfileBody }) =>
      api.updateProfile(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Profile saved");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useProposeSkills() {
  const invalidate = useInvalidateTechnicians();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ProposeSkillsBody }) =>
      api.proposeSkills(id, body),
    onSuccess: (created) => {
      invalidate();
      toast.success(`Proposed ${created.length} ${created.length === 1 ? "skill" : "skills"}`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useApproveSkill() {
  const invalidate = useInvalidateTechnicians();
  return useMutation({
    mutationFn: ({ id, skillId, comments }: { id: string; skillId: string; comments?: string }) =>
      api.approveSkill(id, skillId, comments),
    onSuccess: () => {
      invalidate();
      toast.success("Skill approved");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useRejectSkill() {
  const invalidate = useInvalidateTechnicians();
  return useMutation({
    mutationFn: ({ id, skillId, comments }: { id: string; skillId: string; comments: string }) =>
      api.rejectSkill(id, skillId, comments),
    onSuccess: () => {
      invalidate();
      toast.success("Skill rejected");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useRevokeSkill() {
  const invalidate = useInvalidateTechnicians();
  return useMutation({
    mutationFn: ({ id, skillId }: { id: string; skillId: string }) =>
      api.revokeSkill(id, skillId),
    onSuccess: () => {
      invalidate();
      toast.success("Skill revoked");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useSetCommission() {
  const invalidate = useInvalidateTechnicians();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SetCommissionBody }) =>
      api.setCommission(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Commission updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, docType, file }: { id: string; docType: DocumentType; file: File }) => {
      const { uploadUrl } = await api.getDocumentUploadUrl(id, docType, file.type);
      await api.uploadDocumentBytes(uploadUrl, file);
    },
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.technicians.documents(id) });
      qc.invalidateQueries({ queryKey: queryKeys.technicians.audit(id) });
      toast.success("Document uploaded");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, docType }: { id: string; docType: DocumentType }) =>
      api.deleteDocument(id, docType),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.technicians.documents(id) });
      qc.invalidateQueries({ queryKey: queryKeys.technicians.audit(id) });
      toast.success("Document deleted");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useSetSensitive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SetSensitiveBody }) =>
      api.setSensitive(id, body),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.technicians.sensitive(id) });
      qc.invalidateQueries({ queryKey: queryKeys.technicians.audit(id) });
      toast.success("Sensitive data updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
