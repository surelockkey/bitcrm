"use client";

import { useMemo, useState } from "react";
import type { PortalDocumentSummary } from "@bitcrm/types";
import {
  InvalidPortalLink,
  PortalDocumentViewer,
  PortalLoadError,
  PortalSkeleton,
  PortalView,
  PublicApiError,
  isInvalidPortalError,
  useLoad,
  type DocumentLoaders,
} from "@bitcrm/portal-ui";
import { getDocumentHtml, getDocumentPdfUrl, getPortal } from "@/lib/api";

/** The client's portal at /<token>: their sent estimates and invoices, each readable on the page. */
export function PortalApp({ token }: { token: string }) {
  const portal = useLoad(() => getPortal(token), token);
  const [open, setOpen] = useState<PortalDocumentSummary | null>(null);
  const loaders = useMemo<DocumentLoaders>(
    () => ({
      getHtml: (doc) => getDocumentHtml(token, doc),
      getPdfUrl: (doc, download) => getDocumentPdfUrl(token, doc, download),
    }),
    [token],
  );

  if (portal.loading && !portal.data) return <PortalSkeleton />;
  if (portal.error || !portal.data) {
    if (isInvalidPortalError(portal.error)) {
      return <InvalidPortalLink businessName={portal.error instanceof PublicApiError ? portal.error.businessName : undefined} />;
    }
    return <PortalLoadError onRetry={portal.reload} retrying={portal.loading} />;
  }

  return (
    <>
      <PortalView view={portal.data} onOpen={setOpen} />
      <PortalDocumentViewer doc={open} onClose={() => setOpen(null)} loaders={loaders} scope={`token:${token}`} />
    </>
  );
}
