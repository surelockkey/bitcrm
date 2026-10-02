"use client";

import { useCallback, useMemo } from "react";
import { Eye } from "lucide-react";
import type { PortalView as PortalViewData } from "@bitcrm/types";
import { PortalSkeleton, PortalView, type DocumentLoaders, type InboxLoader } from "@bitcrm/portal-ui";
import { Button } from "@/components/ui/button";
import { toneClasses } from "@/lib/theme/tone";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useDenied } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/billing/components/list-bits";
import { getEstimateHtml, getEstimatePdfUrl } from "@/features/estimates/api";
import { getInvoiceHtml, getInvoicePdfUrl } from "@/features/invoices/api";
import { getPortalPreviewInbox } from "../api";
import { usePortalPreview } from "../hooks";

/** Staff preview of a client's portal (includes unsent documents). Same UI as the client's page. */
export function PortalPreviewPage({ contactId }: { contactId: string }) {
  const denied = useDenied();
  const q = usePortalPreview(contactId);
  // Staff read documents with their own session; the client's page does the same by token.
  const loaders = useMemo<DocumentLoaders>(
    () => ({
      getHtml: (doc) => (doc.kind === "invoice" ? getInvoiceHtml(doc.id) : getEstimateHtml(doc.id)),
      getPdfUrl: (doc, download) =>
        doc.kind === "invoice" ? getInvoicePdfUrl(doc.id, download) : getEstimatePdfUrl(doc.id, download),
    }),
    [],
  );

  // The client's inbox ten at a time, as the client pages it.
  const loadInbox = useCallback<InboxLoader>((q) => getPortalPreviewInbox(contactId, q), [contactId]);

  if (denied("contacts")) return <NoAccess what="client portals" />;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-6 py-3">
        <h1 className="text-lg font-semibold tracking-tight">Client portal preview</h1>
      </div>
      <div
        role="note"
        className={`flex items-center gap-2 border-b px-6 py-2 text-sm ${toneClasses("warning")}`}
      >
        <Eye className="size-4 flex-none" />
        Preview — unsent documents are shown with an UNSENT label. The client only sees sent documents.
      </div>
      <div className="flex-1 overflow-auto bg-white [color-scheme:light]">
        {q.isLoading ? (
          <PortalSkeleton />
        ) : q.isError || !q.data ? (
          <div className="mx-auto max-w-md rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            <p>{getApiErrorMessage(q.error, "Couldn't load the preview")}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => q.refetch()}>Try again</Button>
          </div>
        ) : (
          <PortalView view={previewView(q.data)} loaders={loaders} scope={`preview:${contactId}`} loadInbox={loadInbox} />
        )}
      </div>
    </div>
  );
}

/**
 * Stamped as a preview without minting a new object each render: the portal
 * view reads a new object as a reload and re-reads the pages it had loaded.
 */
const previews = new WeakMap<object, PortalViewData>();
function previewView(data: PortalViewData): PortalViewData {
  if (data.preview) return data;
  let stamped = previews.get(data);
  if (!stamped) {
    stamped = { ...data, preview: true };
    previews.set(data, stamped);
  }
  return stamped;
}
