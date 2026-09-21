"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, Eye, Globe, Link2, Loader2, RefreshCw, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { formatYmd } from "@/features/billing/dates";
import { copyText, useCreatePortalLink, useDeletePortalLink, usePortalLink, usePortalLinkUrl } from "../hooks";
import { usePortalUrlStore } from "../store";
import { RegenerateLinkDialog } from "./regenerate-link-dialog";

/**
 * A client's portal link: status, (re)generate + copy, preview, disable.
 * Managing the link needs invoices.send or estimates.send.
 */
export function PortalLinkCard({ contactId, className }: { contactId: string; className?: string }) {
  const { can } = usePermissions();
  const canManage = can("invoices", "send") || can("estimates", "send");
  const { data: link, isLoading, isError } = usePortalLink(contactId);
  const url = usePortalUrlStore((s) => s.urls[contactId]);
  const create = useCreatePortalLink(contactId);
  const ensure = usePortalLinkUrl(contactId);
  const remove = useDeletePortalLink(contactId);
  const [regenerating, setRegenerating] = useState(false);
  const [disabling, setDisabling] = useState(false);

  const copy = async () => {
    let target: string | undefined = url;
    if (!target) {
      try {
        target = (await ensure.mutateAsync()).url;
      } catch {
        return; // reported by the hook
      }
    }
    if (!target) return;
    if (await copyText(target)) toast.success("Portal link copied");
    else toast.message("Copy the link from the field");
  };

  return (
    <section aria-label="Client portal" className={cn("space-y-3 rounded-lg border p-3", className)}>
      <div className="flex items-center gap-2">
        <span className="flex size-7 flex-none items-center justify-center rounded-md bg-brand/10 text-brand">
          <Globe className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Client portal</div>
          <div className="text-xs text-muted-foreground">Sent estimates and invoices, online.</div>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : isError ? (
        <p className="text-xs text-destructive">Couldn&apos;t load the portal link.</p>
      ) : !link ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">No portal link yet.</p>
          {canManage ? (
            <Button variant="brand" size="sm" onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" /> : <Link2 />} Create link
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Created</dt>
              <dd>{formatYmd(link.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Last viewed</dt>
              <dd>{link.lastViewedAt ? formatYmd(link.lastViewedAt) : "Not yet"}</dd>
            </div>
          </dl>
          <div className="flex items-center gap-1.5">
            {url ? (
              <Input
                readOnly
                value={url}
                aria-label="Portal link"
                className="h-8 min-w-0 flex-1 font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
            ) : null}
            {canManage ? (
              <Button variant="outline" size="sm" className="h-8" onClick={copy} disabled={ensure.isPending}>
                {ensure.isPending ? <Loader2 className="animate-spin" /> : <Copy />} Copy link
              </Button>
            ) : null}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 border-t pt-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/portal/preview/${contactId}`}>
            <Eye /> Preview portal
          </Link>
        </Button>
        {link && canManage ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => setRegenerating(true)} disabled={create.isPending}>
              <RefreshCw /> Regenerate link
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setDisabling(true)}
              disabled={remove.isPending}
            >
              {remove.isPending ? <Loader2 className="animate-spin" /> : <Unlink />} Disable link
            </Button>
          </>
        ) : null}
      </div>

      <RegenerateLinkDialog open={regenerating} onOpenChange={setRegenerating} onConfirm={() => create.mutate()} />

      <AlertDialog open={disabling} onOpenChange={setDisabling}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable the portal link?</AlertDialogTitle>
            <AlertDialogDescription>
              The client will no longer be able to open their documents with the current link. You
              can create a new link at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => remove.mutate()}
            >
              Disable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
