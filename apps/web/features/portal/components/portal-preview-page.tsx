"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, Eye } from "lucide-react";
import type { PortalDocumentSummary } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { getApiErrorMessage } from "@/lib/api/errors";
import { usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/billing/components/list-bits";
import { getEstimatePdfUrl } from "@/features/estimates/api";
import { getInvoicePdfUrl } from "@/features/invoices/api";
import { usePortalPreview } from "../hooks";
import { PortalDocumentViewer } from "./portal-document-viewer";
import { PortalSkeleton } from "./public-portal-page";
import { PortalView } from "./portal-view";

/** Staff preview of a client's portal (includes unsent documents). */
export function PortalPreviewPage({ contactId }: { contactId: string }) {
  const { can } = usePermissions();
  const q = usePortalPreview(contactId);
  const [open, setOpen] = useState<PortalDocumentSummary | null>(null);

  if (!can("contacts")) return <NoAccess what="client portals" />;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-6 py-3">
        <Link
          href={`/contacts/${contactId}`}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" /> Client
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">Client portal preview</h1>
      </div>
      <div
        role="note"
        className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 text-sm text-amber-800 dark:text-amber-300"
      >
        <Eye className="size-4 flex-none" />
        Preview — unsent documents are shown with an UNSENT label. The client only sees sent documents.
      </div>
      <div className="flex-1 overflow-auto bg-muted/30 px-4 py-6 sm:px-6">
        {q.isLoading ? (
          <PortalSkeleton />
        ) : q.isError || !q.data ? (
          <div className="mx-auto max-w-md rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            <p>{getApiErrorMessage(q.error, "Couldn't load the preview")}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => q.refetch()}>Try again</Button>
          </div>
        ) : (
          <PortalView view={{ ...q.data, preview: true }} onOpen={setOpen} />
        )}
      </div>
      <PortalDocumentViewer
        doc={open}
        onClose={() => setOpen(null)}
        scope={`preview:${contactId}`}
        getUrl={(doc, download) =>
          doc.kind === "invoice" ? getInvoicePdfUrl(doc.id, download) : getEstimatePdfUrl(doc.id, download)
        }
      />
    </div>
  );
}
