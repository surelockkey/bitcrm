"use client";

import { Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { copyText, usePortalLinkUrl } from "../hooks";
import { usePortalUrlStore } from "../store";

/**
 * Copies the client's existing portal link — it is never regenerated behind
 * their back (that would kill the URL in a text they already have); a client
 * with no link gets one. Shared by the button and the "Actions ▾" menu item.
 */
export function useCopyPortalLink(contactId: string) {
  const known = usePortalUrlStore((s) => s.urls[contactId]);
  const ensure = usePortalLinkUrl(contactId);

  const copy = async () => {
    let url: string | undefined = known;
    if (!url) {
      try {
        url = (await ensure.mutateAsync()).url;
      } catch {
        return; // reported by the hook
      }
    }
    if (!url) return;
    if (await copyText(url)) toast.success("Portal link copied");
    else toast.message("Copy this link", { description: url });
  };

  return { copy, pending: ensure.isPending, disabled: ensure.isPending || !contactId };
}

/** "Copy client portal link" for a document screen. */
export function CopyPortalLinkButton({
  contactId,
  className,
  variant = "outline",
}: {
  contactId: string;
  className?: string;
  variant?: "outline" | "ghost";
}) {
  const { copy, pending, disabled } = useCopyPortalLink(contactId);
  return (
    <Button type="button" variant={variant} size="sm" className={className} onClick={copy} disabled={disabled}>
      {pending ? <Loader2 className="animate-spin" /> : <Link2 />}
      Copy client portal link
    </Button>
  );
}
