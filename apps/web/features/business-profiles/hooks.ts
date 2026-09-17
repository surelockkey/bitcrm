"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { BusinessProfileView } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { ApiError, getApiErrorMessage } from "@/lib/api/errors";
import { validateImageFile } from "@/features/documents/schemas";
import * as api from "./api";
import { activeCompanies, defaultCompany } from "./lib";
import type { CompanyWriteBody } from "./schemas";

/* --------------------------------------------------------------- queries */

/**
 * Every company, archived included. Read by job forms, pickers and document
 * previews, so it's cached generously; readable by any signed-in user.
 */
export function useBusinessProfiles(enabled = true) {
  return useQuery({
    queryKey: queryKeys.businessProfiles.list(),
    queryFn: api.listBusinessProfiles,
    staleTime: 5 * 60_000,
    enabled,
  });
}

/** Active companies (default first) plus the full list. */
export function useActiveBusinessProfiles(enabled = true) {
  const q = useBusinessProfiles(enabled);
  const active = useMemo(() => activeCompanies(q.data), [q.data]);
  return { ...q, active };
}

/** The default company — what documents print when a job has none. */
export function useDefaultBusinessProfile(enabled = true) {
  const q = useBusinessProfiles(enabled);
  const data = useMemo(() => defaultCompany(q.data), [q.data]);
  return { ...q, data };
}

/** id → company name; falls back to `fallback` (e.g. a job's snapshot). */
export function useCompanyName(): (id: string | undefined, fallback?: string) => string | undefined {
  const { data } = useBusinessProfiles();
  return (id, fallback) => (id ? (data?.find((c) => c.id === id)?.name ?? fallback) : fallback);
}

/* ------------------------------------------------------------- mutations */

/** A 409 carries a sentence the user should read — show it as the description. */
function reportError(title: string) {
  return (e: unknown) => {
    if (e instanceof ApiError && (e.status === 409 || e.status === 422)) {
      toast.error(title, { description: e.message });
    } else {
      toast.error(title, { description: getApiErrorMessage(e) });
    }
  };
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.businessProfiles.all() });
}

export function useCreateBusinessProfile() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CompanyWriteBody) => api.createBusinessProfile(body),
    onSuccess: (c) => {
      invalidate();
      toast.success(`${c.name} added`);
    },
    onError: reportError("Couldn't add the company"),
  });
}

export function useUpdateBusinessProfile() {
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<CompanyWriteBody> }) =>
      api.updateBusinessProfile(id, body),
    onSuccess: (c) => {
      qc.setQueryData<BusinessProfileView[]>(queryKeys.businessProfiles.list(), (old) =>
        old?.map((x) => (x.id === c.id ? c : x)),
      );
      invalidate();
    },
    onError: reportError("Couldn't save the company"),
  });
}

export function useSetDefaultBusinessProfile() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.setDefaultBusinessProfile(id),
    onSuccess: (c) => {
      invalidate();
      toast.success(`${c.name} is now the default company`);
    },
    onError: reportError("Couldn't set the default company"),
  });
}

export function useDeleteBusinessProfile() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.deleteBusinessProfile(id),
    onSuccess: () => {
      invalidate();
      toast.success("Company deleted");
    },
    onError: reportError("Couldn't delete the company"),
  });
}

/**
 * Uploads a logo image with progress (0–100, `null` when idle). Storage
 * failures toast the actual reason (CORS/network vs HTTP status).
 */
export function useLogoUpload() {
  const [progress, setProgress] = useState<number | null>(null);
  const mutation = useMutation({
    mutationFn: async (file: File) => {
      const invalid = validateImageFile(file);
      if (invalid) throw new Error(invalid);
      return api.uploadAsset(file, setProgress);
    },
    onError: (e) => toast.error("Logo upload failed", { description: getApiErrorMessage(e) }),
    onSettled: () => setProgress(null),
  });
  return { ...mutation, progress };
}
