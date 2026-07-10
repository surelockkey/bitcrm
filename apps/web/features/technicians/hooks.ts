"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { DocumentType } from "@bitcrm/types";
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

export function useTechnicians(status?: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.technicians.list(status ?? "all"),
    queryFn: ({ pageParam }) => api.listTechnicians(status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
  });
}

/** id→User map for the name join (profiles store no name). Cached hard. */
export function useUserMap() {
  return useQuery({
    queryKey: queryKeys.technicians.userMap(),
    queryFn: async () =>
      new Map((await api.fetchAllUsers()).map((u) => [u.id, u] as const)),
    staleTime: 5 * 60 * 1000,
  });
}

export function useProfile(id: string) {
  return useQuery({
    queryKey: queryKeys.technicians.profile(id),
    queryFn: () => api.getProfile(id),
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
