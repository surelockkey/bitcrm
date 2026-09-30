"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
// Imported by path, not from the barrel: this module pulls in Stripe.js, and the
// staff app (which shares @bitcrm/portal-ui) must not carry it.
import { PaymentPanel, type PaymentLoaders } from "@bitcrm/portal-ui/src/payment-panel";
import { getDocumentHtml, getDocumentPdfUrl, getPaymentOptions, getPaymentStatus, getPortal, startPayment } from "@/lib/api";
import { env } from "@/lib/env";

/** Stripe sends a customer back here after a redirect-based method. */
const PAYMENT_PARAM = "payment";
const INVOICE_PARAM = "invoice";

interface Resume {
  paymentId: string;
  invoiceId: string;
}

/**
 * Read once, at the first client render — never on the server, which has no
 * `location`. Safe for hydration: the first paint is the skeleton either way,
 * because the panel cannot appear until the portal itself has loaded.
 */
function readResume(): Resume | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const paymentId = params.get(PAYMENT_PARAM);
  return paymentId ? { paymentId, invoiceId: params.get(INVOICE_PARAM) ?? "" } : null;
}

/** The client's portal at /<token>: their sent estimates and invoices, each readable and payable on the page. */
export function PortalApp({ token }: { token: string }) {
  const portal = useLoad(() => getPortal(token), token);
  const [open, setOpen] = useState<PortalDocumentSummary | null>(null);
  const [paying, setPaying] = useState<PortalDocumentSummary | null>(null);
  const [resume, setResume] = useState<Resume | null>(readResume);

  // Wipe the id from the address bar at once, so a refresh — or a shared link —
  // cannot replay someone else's payment screen.
  useEffect(() => {
    if (resume) window.history.replaceState(null, "", window.location.pathname);
  }, [resume]);

  const loaders = useMemo<DocumentLoaders>(
    () => ({
      getHtml: (doc) => getDocumentHtml(token, doc),
      getPdfUrl: (doc, download) => getDocumentPdfUrl(token, doc, download),
    }),
    [token],
  );

  const payment = useMemo<PaymentLoaders>(
    () => ({
      getOptions: (doc) => getPaymentOptions(token, doc.id),
      start: async (doc, body) => {
        const session = await startPayment(token, doc.id, body);
        // The key belongs to the API response; the build-time one is a fallback
        // for deployments that would rather pin it. Both are publishable.
        return session.publishableKey ? session : { ...session, publishableKey: env.stripePublishableKey ?? "" };
      },
      getStatus: (paymentId) => getPaymentStatus(token, paymentId),
    }),
    [token],
  );

  const returnUrl = useCallback(
    (paymentId: string, invoiceId: string) =>
      `${window.location.origin}${window.location.pathname}?${PAYMENT_PARAM}=${encodeURIComponent(paymentId)}&${INVOICE_PARAM}=${encodeURIComponent(invoiceId)}`,
    [],
  );

  const reload = portal.reload;
  const closePayment = useCallback(() => {
    setPaying(null);
    setResume(null);
  }, []);

  if (portal.loading && !portal.data) return <PortalSkeleton />;
  if (portal.error || !portal.data) {
    if (isInvalidPortalError(portal.error)) {
      return <InvalidPortalLink businessName={portal.error instanceof PublicApiError ? portal.error.businessName : undefined} />;
    }
    return <PortalLoadError onRetry={portal.reload} retrying={portal.loading} />;
  }

  const view = portal.data;
  // Paying is for real clients only: the staff preview reads, it does not pay.
  const canPay = !view.preview;
  const resumeDoc = resume ? (view.invoices.find((i) => i.id === resume.invoiceId) ?? stubInvoice(resume.invoiceId)) : null;
  const panelDoc = resumeDoc ?? paying;

  return (
    <>
      <PortalView view={view} onOpen={setOpen} onPay={canPay ? setPaying : undefined} />
      <PortalDocumentViewer
        doc={open}
        onClose={() => setOpen(null)}
        loaders={loaders}
        scope={`token:${token}`}
        onPay={canPay ? setPaying : undefined}
      />
      {panelDoc ? (
        <PaymentPanel
          key={`${panelDoc.id}:${resume?.paymentId ?? "new"}`}
          doc={panelDoc}
          loaders={payment}
          onClose={closePayment}
          onPaid={reload}
          businessName={view.business.name}
          returnUrl={(paymentId) => returnUrl(paymentId, panelDoc.id)}
          resumePaymentId={resume?.paymentId}
        />
      ) : null}
    </>
  );
}

/** A returning customer whose invoice has since dropped off the portal still deserves an answer. */
function stubInvoice(id: string): PortalDocumentSummary {
  return { kind: "invoice", id, number: "", date: "", status: "due", total: 0, sent: true };
}
