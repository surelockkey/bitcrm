"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Download, ExternalLink, Loader2 } from "lucide-react";
import type { PortalDocumentSummary } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatMoney } from "@/features/billing/lib";
import { documentKindLabel } from "../lib";

export type PdfUrlGetter = (doc: PortalDocumentSummary, download: boolean) => Promise<{ url: string }>;

/**
 * Full-screen on phones, a wide side panel on desktop, with the PDF embedded.
 * iOS Safari often renders only the first page of an inline PDF (or nothing),
 * so "Open in new tab" and "Download" are always offered.
 */
export function PortalDocumentViewer({
  doc,
  onClose,
  getUrl,
  scope,
}: {
  doc: PortalDocumentSummary | null;
  onClose: () => void;
  getUrl: PdfUrlGetter;
  /** Distinguishes caches (token vs preview contact). */
  scope: string;
}) {
  return (
    <Sheet open={doc !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
      >
        {doc ? <ViewerBody key={`${doc.kind}-${doc.id}`} doc={doc} getUrl={getUrl} scope={scope} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function ViewerBody({ doc, getUrl, scope }: { doc: PortalDocumentSummary; getUrl: PdfUrlGetter; scope: string }) {
  const [loaded, setLoaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const pdf = useQuery({
    queryKey: ["portal", "pdf", scope, doc.kind, doc.id],
    queryFn: () => getUrl(doc, false),
    // Signed URLs expire; always ask again when the viewer reopens.
    staleTime: 0,
    gcTime: 0,
    retry: 1,
  });
  const title = `${documentKindLabel(doc.kind)} #${doc.number}`;

  const download = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      const { url } = await getUrl(doc, true);
      window.location.assign(url);
    } catch {
      setDownloadError("Couldn't prepare the download. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <SheetHeader className="border-b pr-12">
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>
          {doc.name ? `${doc.name} · ` : ""}
          {formatMoney(doc.total)}
        </SheetDescription>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="brand" size="sm" onClick={download} disabled={downloading}>
            {downloading ? <Loader2 className="animate-spin" /> : <Download />} Download PDF
          </Button>
          {pdf.data ? (
            <Button asChild variant="outline" size="sm">
              <a href={pdf.data.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink /> Open in new tab
              </a>
            </Button>
          ) : null}
        </div>
        {downloadError ? <p className="text-xs text-destructive">{downloadError}</p> : null}
      </SheetHeader>

      <div className="relative min-h-0 flex-1 bg-muted/40">
        {pdf.isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <AlertCircle className="size-5 text-destructive" />
            We couldn&apos;t load this document.
            <Button variant="outline" size="sm" onClick={() => pdf.refetch()}>Try again</Button>
          </div>
        ) : (
          <>
            {!loaded ? (
              <div
                role="status"
                className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground"
              >
                <Loader2 className="size-5 animate-spin" />
                Loading {documentKindLabel(doc.kind).toLowerCase()}…
              </div>
            ) : null}
            {pdf.data ? (
              <iframe
                title={title}
                src={pdf.data.url}
                onLoad={() => setLoaded(true)}
                className="size-full border-0"
              />
            ) : null}
          </>
        )}
      </div>
      <p className="border-t px-4 py-2 text-center text-[11px] text-muted-foreground sm:hidden">
        Can&apos;t see the document? Use “Open in new tab” or “Download PDF”.
      </p>
    </>
  );
}
