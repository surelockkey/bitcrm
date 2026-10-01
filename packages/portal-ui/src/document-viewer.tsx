"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, CreditCard, Download, ExternalLink, Loader2 } from "lucide-react";
import type { PortalDocumentSummary } from "@bitcrm/types";
import { DocumentFrame } from "./document-frame";
import { cx, documentKindLabel, documentTitle, formatMoney, isOwing } from "./lib";
import { goTo } from "./navigate";
import { StatusBadge } from "./status-badge";
import { useLoad } from "./use-load";

/** How a host app gets a document: the public portal by token, the staff preview by session. */
export interface DocumentLoaders {
  getHtml: (doc: PortalDocumentSummary) => Promise<{ html: string }>;
  getPdfUrl: (doc: PortalDocumentSummary, download: boolean) => Promise<{ url: string }>;
}

/* Workiz's portal buttons: full pills, the yellow one for the one thing to do, an ink outline for the rest. */
const button =
  "inline-flex h-10 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-[#6aa8ee] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60";
export const primaryButton = cx(button, "bg-[#ffd503] text-[#3b4b52] hover:bg-[#f7d006]");
export const outlineButton = cx(button, "border border-[#3b4b52]/70 bg-white text-[#3b4b52] hover:bg-[#f3f4f5]");

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
  onPay,
}: {
  doc: PortalDocumentSummary | null;
  onClose: () => void;
  loaders: DocumentLoaders;
  /** Tells one host's documents from another's (token, or preview contact). */
  scope: string;
  /** Absent wherever paying is not on offer (the staff preview). */
  onPay?: (doc: PortalDocumentSummary) => void;
}) {
  if (!doc) return null;
  return <Viewer key={`${scope}:${doc.kind}:${doc.id}`} doc={doc} onClose={onClose} loaders={loaders} scope={scope} onPay={onPay} />;
}

function Viewer({
  doc,
  onClose,
  loaders,
  scope,
  onPay,
}: {
  doc: PortalDocumentSummary;
  onClose: () => void;
  loaders: DocumentLoaders;
  scope: string;
  onPay?: (doc: PortalDocumentSummary) => void;
}) {
  const title = documentTitle(doc);
  const owing = isOwing(doc);
  const payNow = onPay && owing && doc.payable === true;
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
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col bg-white">
      <header className="border-b bg-white pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-3 py-2.5 sm:px-5">
          <button
            ref={back}
            type="button"
            onClick={onClose}
            aria-label="Back to all documents"
            className="-ml-1 inline-flex size-10 flex-none items-center justify-center rounded-lg hover:bg-[#f3f4f5] focus-visible:ring-2 focus-visible:ring-[#6aa8ee] focus-visible:outline-none"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base leading-tight font-semibold">{title}</h2>
            <p className="truncate text-xs text-[#637075]">
              {doc.name ? `${doc.name} · ` : ""}
              {formatMoney(doc.total)}
            </p>
          </div>
          <StatusBadge doc={doc} />
        </div>
        <div className="mx-auto flex w-full max-w-4xl flex-wrap gap-2 px-3 pb-2.5 sm:px-5">
          {payNow ? (
            <button type="button" onClick={() => onPay(doc)} className={cx(primaryButton, "w-full sm:w-auto")}>
              <CreditCard className="size-4" aria-hidden /> Pay {formatMoney(doc.balanceDue ?? doc.total)}
            </button>
          ) : null}
          <button type="button" onClick={download} disabled={busy !== null} className={cx(payNow ? outlineButton : primaryButton, "flex-1 sm:flex-none")}>
            {busy === "download" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
            Download PDF
          </button>
          <button type="button" onClick={open} disabled={busy !== null} className={cx(outlineButton, "flex-1 sm:flex-none")}>
            {busy === "open" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ExternalLink className="size-4" aria-hidden />}
            Open PDF
          </button>
        </div>
        {onPay && owing && !payNow ? (
          <p className="mx-auto max-w-4xl px-3 pb-2 text-xs text-[#637075] sm:px-5">
            Online payment isn&apos;t available for this invoice — please contact us to pay.
          </p>
        ) : null}
        {pdfError ? (
          <p role="alert" className="mx-auto max-w-4xl px-3 pb-2 text-xs text-[#e05c5c] sm:px-5">
            {pdfError}
          </p>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-auto bg-[#f3f4f5] pb-[env(safe-area-inset-bottom)]">
        {page.loading ? (
          <div role="status" className="flex h-full min-h-64 flex-col items-center justify-center gap-2 text-sm text-[#637075]">
            <Loader2 className="size-5 animate-spin" aria-hidden />
            Loading {documentKindLabel(doc.kind).toLowerCase()}…
          </div>
        ) : page.error || !page.data ? (
          <div className="mx-auto flex max-w-sm flex-col items-center gap-3 p-8 text-center text-sm text-[#637075]">
            <AlertCircle className="size-6 text-[#e05c5c]" aria-hidden />
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
