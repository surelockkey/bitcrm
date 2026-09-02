"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";

/* --------------------------------------------------------------- queries */

/**
 * The external-company catalog. Read on the job forms to resolve ids to names,
 * so it's cached generously — the catalog changes rarely.
 */
export function useExternalCompanies() {
  return useQuery({
    queryKey: queryKeys.externalCompanies.list(),
    queryFn: api.listExternalCompanies,
    staleTime: 5 * 60_000,
  });
}

export function useExternalCompany(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.externalCompanies.detail(id),
    queryFn: () => api.getExternalCompany(id),
    enabled,
  });
}

/* ------------------------------------------------------------- mutations */

function useInvalidateExternalCompanies() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.externalCompanies.all() });
}

export function useCreateExternalCompany() {
  const invalidate = useInvalidateExternalCompanies();
  return useMutation({
    mutationFn: (body: unknown) => api.createExternalCompany(body),
    onSuccess: () => {
      invalidate();
      toast.success("External company created");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateExternalCompany(id: string) {
  const invalidate = useInvalidateExternalCompanies();
  return useMutation({
    mutationFn: (body: unknown) => api.updateExternalCompany(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("External company updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/** Enable/disable without opening the form — the list's inline toggle. */
export function useToggleExternalCompany() {
  const invalidate = useInvalidateExternalCompanies();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.updateExternalCompany(id, { active }),
    onSuccess: (company) => {
      invalidate();
      toast.success(
        company.active
          ? `${company.name} enabled`
          : `${company.name} disabled — it leaves the job pickers`,
      );
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteExternalCompany() {
  const invalidate = useInvalidateExternalCompanies();
  return useMutation({
    mutationFn: (id: string) => api.deleteExternalCompany(id),
    onSuccess: (res) => {
      invalidate();
      // The backend disables a company still in use rather than deleting it.
      toast.success(
        res.archived ? "Company disabled (still used by jobs)" : "External company deleted",
      );
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
