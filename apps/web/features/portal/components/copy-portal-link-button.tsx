"use client";

import { Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { copyText, usePortalLinkUrl } from "../hooks";
import { usePortalUrlStore } from "../store";

/**
 * "Copy client portal link" for a document screen. Copies the client's
 * existing link — it is never regenerated behind their back (that would kill
 * the URL in a text they already have); a client with no link gets one.
 */
export function CopyPortalLinkButton({
  contactId,
  className,
  variant = "outline",
}: {
  contactId: string;
  className?: string;
  variant?: "outline" | "ghost";
}) {
  const known = usePortalUrlStore((s) => s.urls[contactId]);
  const ensure = usePortalLinkUrl(contactId);

  const onClick = async () => {
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

  return (
    <Button type="button" variant={variant} size="sm" className={className} onClick={onClick} disabled={ensure.isPending || !contactId}>
      {ensure.isPending ? <Loader2 className="animate-spin" /> : <Link2 />}
      Copy client portal link
    </Button>
  );
}
