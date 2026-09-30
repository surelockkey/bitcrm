"use client";

import { useQuery } from "@tanstack/react-query";
import type { DocumentTemplateKind, DocumentTemplateSummary } from "@bitcrm/types";
import { http } from "@/lib/api/http";
import { queryKeys } from "@/lib/query-keys";

export const listDocumentTemplates = (): Promise<DocumentTemplateSummary[]> =>
  http.get<DocumentTemplateSummary[]>("/billing/templates");

/**
 * The template catalog (shared cache with Settings → Documents), narrowed to
 * one kind for the per-document picker.
 */
export function useDocumentTemplatesOfKind(kind: DocumentTemplateKind, enabled = true) {
  const q = useQuery({
    queryKey: queryKeys.documentTemplates.list(),
    queryFn: listDocumentTemplates,
    enabled,
    staleTime: 5 * 60_000,
  });
  return { ...q, templates: (q.data ?? []).filter((t) => t.kind === kind) };
}
