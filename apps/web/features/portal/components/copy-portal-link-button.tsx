"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { getPortalLink } from "../api";
import { copyText, useCreatePortalLink } from "../hooks";
import { usePortalUrlStore } from "../store";
import { RegenerateLinkDialog } from "./regenerate-link-dialog";

/**
 * "Copy client portal link" for a document screen. The URL is only known
 * right after (re)generation, so an existing link we can't show is
 * regenerated — after a confirmation, since that kills the old one.
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
  const qc = useQueryClient();
  const url = usePortalUrlStore((s) => s.urls[contactId]);
  const create = useCreatePortalLink(contactId);
  const [confirming, setConfirming] = useState(false);
  const [checking, setChecking] = useState(false);

  const onClick = async () => {
    if (url) {
      const ok = await copyText(url);
      if (ok) toast.success("Portal link copied");
      else toast.message("Copy this link", { description: url });
      return;
    }
    setChecking(true);
    try {
      const existing = await qc.fetchQuery({
        queryKey: queryKeys.portal.link(contactId),
        queryFn: () => getPortalLink(contactId),
      });
      if (existing) setConfirming(true);
      else create.mutate();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setChecking(false);
    }
  };

  const busy = checking || create.isPending;

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size="sm"
        className={className}
        onClick={onClick}
        disabled={busy || !contactId}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Link2 />}
        Copy client portal link
      </Button>
      <RegenerateLinkDialog open={confirming} onOpenChange={setConfirming} onConfirm={() => create.mutate()} />
    </>
  );
}
