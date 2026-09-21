"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";
import { usePortalUrlStore } from "./store";

export function usePortalLink(contactId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.portal.link(contactId),
    queryFn: () => api.getPortalLink(contactId),
    enabled: enabled && !!contactId,
  });
}

export function usePortalPreview(contactId: string) {
  return useQuery({
    queryKey: [...queryKeys.portal.link(contactId), "preview"],
    queryFn: () => api.getPortalPreview(contactId),
    enabled: !!contactId,
  });
}

/** Copy text; resolves false when the Clipboard API is unavailable/denied. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** (Re)generate the link; the URL is remembered and copied. */
export function useCreatePortalLink(contactId: string) {
  const qc = useQueryClient();
  const remember = usePortalUrlStore((s) => s.remember);
  return useMutation({
    mutationFn: () => api.createPortalLink(contactId),
    onSuccess: async (link) => {
      qc.setQueryData(queryKeys.portal.link(contactId), { ...link, url: undefined, token: undefined });
      qc.invalidateQueries({ queryKey: queryKeys.portal.link(contactId) });
      if (!link.url) {
        toast.success("Portal link created");
        return;
      }
      remember(contactId, link.url);
      const copied = await copyText(link.url);
      toast.success(copied ? "Portal link created and copied" : "Portal link created");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/**
 * The link's URL for copying / texting, WITHOUT regenerating it: the client's
 * earlier link keeps working. Remembers the URL for this browser session.
 */
export function usePortalLinkUrl(contactId: string) {
  const qc = useQueryClient();
  const remember = usePortalUrlStore((s) => s.remember);
  return useMutation({
    mutationFn: () => api.getPortalLinkUrl(contactId),
    onSuccess: (link) => {
      qc.setQueryData(queryKeys.portal.link(contactId), { ...link, url: undefined, token: undefined, replaced: undefined });
      qc.invalidateQueries({ queryKey: queryKeys.portal.link(contactId) });
      if (link.url) remember(contactId, link.url);
      if (link.replaced) {
        toast.message("A new portal link was created", {
          description: "This client's earlier link was from before links could be re-sent, so it no longer works.",
        });
      }
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeletePortalLink(contactId: string) {
  const qc = useQueryClient();
  const forget = usePortalUrlStore((s) => s.forget);
  return useMutation({
    mutationFn: () => api.deletePortalLink(contactId),
    onSuccess: () => {
      forget(contactId);
      qc.setQueryData(queryKeys.portal.link(contactId), null);
      qc.invalidateQueries({ queryKey: queryKeys.portal.link(contactId) });
      toast.success("Portal link disabled");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
