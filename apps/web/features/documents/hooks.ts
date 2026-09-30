"use client";

import { useMemo } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { BusinessProfile, BusinessProfileView, DocumentRenderContext, DocumentTemplate, DocumentTemplateKind } from "@bitcrm/types";
import { sampleRenderContext } from "@bitcrm/document-renderer";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";
import { isVersionConflict } from "./lib";
import { useDefaultBusinessProfile } from "@/features/business-profiles/hooks";
import { validateImageFile, type NewTemplateValues } from "./schemas";

/**
 * Keys local to this feature. Asset URLs are presigned and expire, so they get
 * their own key space (not under `documentTemplates`, whose invalidation would
 * needlessly re-sign every image).
 */
export const documentKeys = {
  assetUrl: (id: string) => ["billing-assets", id, "url"] as const,
  render: (req: api.RenderRequest) => [...queryKeys.documentTemplates.all(), "render", req] as const,
  previewSources: (kind: string, query: string) => [...queryKeys.documentTemplates.all(), "preview-sources", kind, query] as const,
  fullPreview: (format: "pdf" | "html", req: api.RenderRequest | null) =>
    [...queryKeys.documentTemplates.all(), "full-preview", format, req] as const,
};

/** Presigned URLs are refreshed well before they expire. */
const ASSET_URL_STALE_MS = 10 * 60_000;

/* ------------------------------------------------------------- templates */

export function useDocumentTemplates(enabled = true) {
  return useQuery({
    queryKey: queryKeys.documentTemplates.list(),
    queryFn: api.listTemplates,
    enabled,
    staleTime: 60_000,
  });
}

/**
 * One template. Cached indefinitely (the editor owns the working copy and must
 * never have it replaced behind the user's back); `fresh` refetches on mount
 * so the editor starts from the latest version.
 */
export function useDocumentTemplate(id: string, enabled = true, opts: { fresh?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.documentTemplates.detail(id),
    queryFn: () => api.getTemplate(id),
    enabled: enabled && !!id,
    staleTime: Infinity,
    refetchOnMount: opts.fresh ? "always" : undefined,
    refetchOnWindowFocus: false,
  });
}

function useInvalidateTemplates() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.documentTemplates.list() });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: (body: NewTemplateValues) => api.createTemplate(body),
    onSuccess: (t) => {
      qc.setQueryData(queryKeys.documentTemplates.detail(t.id), t);
      invalidate();
      toast.success("Template created");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDuplicateTemplate() {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: (id: string) => api.duplicateTemplate(id),
    onSuccess: () => {
      invalidate();
      toast.success("Template duplicated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useSetDefaultTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.setDefaultTemplate(id),
    onSuccess: () => {
      // Other templates of the kind lost their default flag too.
      qc.invalidateQueries({ queryKey: queryKeys.documentTemplates.all() });
      toast.success("Default template updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteTemplate(id),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: queryKeys.documentTemplates.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.documentTemplates.list() });
      toast.success("Template deleted");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/** Saves the editor draft. Version conflicts (409) are left to the caller. */
export function useSaveTemplate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: api.TemplateUpdateBody) => api.updateTemplate(id, body),
    onSuccess: (t: DocumentTemplate) => {
      qc.setQueryData(queryKeys.documentTemplates.detail(id), t);
      qc.invalidateQueries({ queryKey: queryKeys.documentTemplates.list() });
    },
    onError: (e) => {
      if (!isVersionConflict(e)) toast.error(getApiErrorMessage(e, "Couldn't save the template"));
    },
  });
}

/**
 * The company previews show: the default company. (Kept under the old name so
 * the editor call sites stay unchanged.)
 */
export function useBusinessProfile(enabled = true) {
  return useDefaultBusinessProfile(enabled);
}

/* ---------------------------------------------------------------- assets */

export function useUploadAsset() {
  return useMutation({
    mutationFn: async (file: File) => {
      const invalid = validateImageFile(file);
      if (invalid) throw new Error(invalid);
      return api.uploadAsset(file);
    },
    onError: (e) => toast.error("Image upload failed", { description: getApiErrorMessage(e) }),
  });
}

/** Resolves asset ids to (cached, presigned) URLs. Unresolved ids are omitted. */
export function useAssetUrls(assetIds: string[]): Record<string, string> {
  const idsKey = [...new Set(assetIds.filter(Boolean))].sort().join("\n");
  const ids = useMemo(() => (idsKey ? idsKey.split("\n") : []), [idsKey]);
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: documentKeys.assetUrl(id),
      queryFn: () => api.getAssetUrl(id),
      staleTime: ASSET_URL_STALE_MS,
      gcTime: 30 * 60_000,
      retry: 1,
    })),
  });
  // A stable string of the resolved values keeps the returned map referentially
  // stable between renders (it feeds memoized block rendering).
  const key = results.map((r) => r.data ?? "").join("\n");
  return useMemo(() => {
    const urls = key.split("\n");
    const out: Record<string, string> = {};
    ids.forEach((id, i) => {
      if (urls[i]) out[id] = urls[i];
    });
    return out;
  }, [ids, key]);
}

/* -------------------------------------------------------------- previews */

function formatAddress(a: BusinessProfile["address"]): string | undefined {
  if (!a?.street) return undefined;
  const street = a.unit ? `${a.street} ${a.unit}` : a.street;
  return `${street}, ${a.city}, ${a.state} ${a.zip}`.trim();
}

/**
 * Sample data for the editor, with the default company (name, logo…)
 * laid over it so the preview looks like the user's own document.
 */
export function useSampleContext(
  kind: DocumentTemplateKind,
  profile: BusinessProfileView | undefined,
  assets: Record<string, string>,
): DocumentRenderContext {
  return useMemo(() => {
    const ctx = sampleRenderContext(kind);
    if (profile) {
      ctx.business = {
        name: profile.name || ctx.business.name,
        legalName: profile.legalName,
        phone: profile.phone,
        email: profile.email,
        website: profile.website,
        licenseNumber: profile.licenseNumber,
        address: formatAddress(profile.address),
        logoUrl: profile.logoUrl,
      };
    }
    ctx.assets = assets;
    return ctx;
  }, [kind, profile, assets]);
}

/** Server-rendered HTML for a real invoice/estimate (debounce `req` upstream). */
export function useServerPreviewHtml(req: api.RenderRequest | null) {
  return useQuery({
    queryKey: req ? documentKeys.render(req) : [...queryKeys.documentTemplates.all(), "render", "off"],
    queryFn: () => api.renderTemplateHtml(req as api.RenderRequest),
    enabled: !!req?.source,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function usePreviewSources(kind: api.PreviewSource["kind"], query: string, enabled: boolean) {
  return useQuery({
    queryKey: documentKeys.previewSources(kind, query),
    queryFn: () => api.searchPreviewSources(kind, query),
    enabled,
    staleTime: 30_000,
  });
}
