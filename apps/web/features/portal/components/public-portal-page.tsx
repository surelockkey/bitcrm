"use client";

import { useState } from "react";
import { Link2Off, Loader2, RefreshCw } from "lucide-react";
import type { PortalDocumentSummary } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getPublicPortalPdf } from "../api";
import { usePublicPortal } from "../hooks";
import { PublicApiError, isInvalidPortalError, portalPdfPath } from "../lib";
import { publicGet } from "../public-http";
import { PortalDocumentViewer } from "./portal-document-viewer";
import { PortalView } from "./portal-view";

export function PortalSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6" aria-busy>
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="h-6 w-2/3" />
      <div className="space-y-2">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    </div>
  );
}

export function InvalidPortalLink({ businessName }: { businessName?: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border bg-card p-8 text-center shadow-xs">
      <span className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Link2Off className="size-6" />
      </span>
      <h1 className="text-lg font-semibold">This link is no longer valid</h1>
      <p className="text-sm text-muted-foreground">
        {businessName
          ? `Please contact ${businessName} for a new link to your documents.`
          : "Please contact the business that sent it to you for a new link to your documents."}
      </p>
    </div>
  );
}

/** The client-facing portal at /portal/[token]. */
export function PublicPortalPage({ token }: { token: string }) {
  const q = usePublicPortal(token);
  const [open, setOpen] = useState<PortalDocumentSummary | null>(null);

  if (q.isLoading) return <PortalSkeleton />;
  if (q.isError) {
    if (isInvalidPortalError(q.error)) {
      return <InvalidPortalLink businessName={q.error instanceof PublicApiError ? q.error.businessName : undefined} />;
    }
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border bg-card p-8 text-center">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">We couldn&apos;t load your documents. Please try again.</p>
        <Button variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />} Try again
        </Button>
      </div>
    );
  }
  if (!q.data) return <InvalidPortalLink />;

  return (
    <>
      <PortalView view={q.data} onOpen={setOpen} />
      <PortalDocumentViewer
        doc={open}
        onClose={() => setOpen(null)}
        scope={`token:${token}`}
        getUrl={(doc, download) =>
          download
            ? publicGet<{ url: string }>(`${portalPdfPath(token, doc.kind, doc.id)}?download=1`)
            : getPublicPortalPdf(token, doc.kind, doc.id)
        }
      />
    </>
  );
}
