"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Download, ExternalLink, Loader2 } from "lucide-react";
import type { PortalDocumentSummary } from "@bitcrm/types";
import { DocumentFrame } from "./document-frame";
import { cx, documentKindLabel, documentTitle, formatMoney } from "./lib";
import { goTo } from "./navigate";
import { StatusBadge } from "./status-badge";
import { useLoad } from "./use-load";

/** How a host app gets a document: the public portal by token, the staff preview by session. */
export interface DocumentLoaders {
  getHtml: (doc: PortalDocumentSummary) => Promise<{ html: string }>;
  getPdfUrl: (doc: PortalDocumentSummary, download: boolean) => Promise<{ url: string }>;
}

const button =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60";
export const primaryButton = cx(button, "bg-brand text-brand-foreground hover:bg-brand/90");
export const outlineButton = cx(button, "border bg-card hover:bg-accent");

/**
 * A document, full screen. The page itself (HTML) comes first — readable at
 * any width, no plug-in, no tiny embedded PDF viewer — and the PDF is one tap
 * away as a download or a new tab.
 */
export function PortalDocumentViewer({
  doc,
  onClose,
  loaders,
  scope,
}: {
  doc: PortalDocumentSummary | null;
  onClose: () => void;
  loaders: DocumentLoaders;
  /** Tells one host's documents from another's (token, or preview contact). */
  scope: string;
}) {
  if (!doc) return null;
  return <Viewer key={`${scope}:${doc.kind}:${doc.id}`} doc={doc} onClose={onClose} loaders={loaders} scope={scope} />;
}

function Viewer({
  doc,
  onClose,
  loaders,
  scope,
}: {
  doc: PortalDocumentSummary;
  onClose: () => void;
  loaders: DocumentLoaders;
  scope: string;
}) {
  const title = documentTitle(doc);
  const page = useLoad(() => loaders.getHtml(doc), `${scope}:${doc.kind}:${doc.id}`);
  const [busy, setBusy] = useState<"download" | "open" | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const back = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    back.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const download = async () => {
    setBusy("download");
    setPdfError(null);
    try {
      const { url } = await loaders.getPdfUrl(doc, true);
      goTo(url);
    } catch {
      setPdfError("Couldn't prepare the PDF. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const open = async () => {
    // Opened first, pointed later: a window opened after an await is a blocked pop-up.
    const tab = window.open("", "_blank");
    setBusy("open");
    setPdfError(null);
    try {
      const { url } = await loaders.getPdfUrl(doc, false);
      if (tab) tab.location.href = url;
      else goTo(url);
    } catch {
      tab?.close();
      setPdfError("Couldn't open the PDF. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="border-b bg-card pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-3 py-2.5 sm:px-5">
          <button
            ref={back}
            type="button"
            onClick={onClose}
            aria-label="Back to all documents"
            className="-ml-1 inline-flex size-10 flex-none items-center justify-center rounded-lg hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base leading-tight font-semibold">{title}</h2>
            <p className="truncate text-xs text-muted-foreground">
              {doc.name ? `${doc.name} · ` : ""}
              {formatMoney(doc.total)}
            </p>
          </div>
          <StatusBadge doc={doc} />
        </div>
        <div className="mx-auto flex w-full max-w-4xl gap-2 px-3 pb-2.5 sm:px-5">
          <button type="button" onClick={download} disabled={busy !== null} className={cx(primaryButton, "flex-1 sm:flex-none")}>
            {busy === "download" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
            Download PDF
          </button>
          <button type="button" onClick={open} disabled={busy !== null} className={cx(outlineButton, "flex-1 sm:flex-none")}>
            {busy === "open" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ExternalLink className="size-4" aria-hidden />}
            Open PDF
          </button>
        </div>
        {pdfError ? (
          <p role="alert" className="mx-auto max-w-4xl px-3 pb-2 text-xs text-destructive sm:px-5">
            {pdfError}
          </p>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-auto bg-muted/40 pb-[env(safe-area-inset-bottom)]">
        {page.loading ? (
          <div role="status" className="flex h-full min-h-64 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-hidden />
            Loading {documentKindLabel(doc.kind).toLowerCase()}…
          </div>
        ) : page.error || !page.data ? (
          <div className="mx-auto flex max-w-sm flex-col items-center gap-3 p-8 text-center text-sm text-muted-foreground">
            <AlertCircle className="size-6 text-destructive" aria-hidden />
            <p>We couldn&apos;t show this {documentKindLabel(doc.kind).toLowerCase()} on the page. You can still get the PDF above.</p>
            <button type="button" onClick={page.reload} className={outlineButton}>
              Try again
            </button>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[880px] sm:py-5">
            <DocumentFrame html={page.data.html} title={title} />
          </div>
        )}
      </div>
    </div>
  );
}
