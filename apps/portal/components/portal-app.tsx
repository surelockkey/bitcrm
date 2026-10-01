"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PortalDocumentSummary } from "@bitcrm/types";
import {
  InvalidPortalLink,
  PortalLoadError,
  PortalSkeleton,
  PortalView,
  PublicApiError,
  isInvalidPortalError,
  useLoad,
  type DocumentLoaders,
  type PortalActions,
} from "@bitcrm/portal-ui";
// Imported by path, not from the barrel: these modules pull in Stripe.js, and
// the staff app (which shares @bitcrm/portal-ui) must not carry it.
import { PaymentPanel, type PaymentLoaders } from "@bitcrm/portal-ui/src/payment-panel";
import { SignAndPayPanel } from "@bitcrm/portal-ui/src/sign-pay-panel";
import {
  approveEstimate,
  declineEstimate,
  getDepositOptions,
  getDocumentHtml,
  getDocumentPdfUrl,
  getPaymentOptions,
  getPaymentStatus,
  getPortal,
  signInvoice,
  startDeposit,
  startPayment,
} from "@/lib/api";
import { env } from "@/lib/env";

/** Stripe sends a customer back here after a redirect-based method. */
const PAYMENT_PARAM = "payment";
const INVOICE_PARAM = "invoice";

interface Resume {
  paymentId: string;
  documentId: string;
}

/** What is open on top of the portal. */
type Panel =
  | { kind: "approve"; doc: PortalDocumentSummary }
  | { kind: "sign-invoice"; doc: PortalDocumentSummary }
  | { kind: "pay"; doc: PortalDocumentSummary }
  | { kind: "deposit"; doc: PortalDocumentSummary }
  | { kind: "decline"; doc: PortalDocumentSummary }
  | null;

/**
 * Read once, at the first client render — never on the server, which has no
 * `location`. Safe for hydration: the first paint is the skeleton either way,
 * because the panel cannot appear until the portal itself has loaded.
 */
function readResume(): Resume | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const paymentId = params.get(PAYMENT_PARAM);
  return paymentId ? { paymentId, documentId: params.get(INVOICE_PARAM) ?? "" } : null;
}

/**
 * The client's portal at /<token>, as Workiz lays it out: the inbox of sent
 * estimates, proposals and invoices, My Booking, the profile — and on top of
 * it the client's decisions: approve (= sign, then the deposit), decline,
 * sign and pay. Signature always comes before money.
 */
export function PortalApp({ token }: { token: string }) {
  const portal = useLoad(() => getPortal(token), token);
  const [panel, setPanel] = useState<Panel>(null);
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

  const withKey = useCallback((session: Awaited<ReturnType<typeof startPayment>>) =>
    // The key belongs to the API response; the build-time one is a fallback
    // for deployments that would rather pin it. Both are publishable.
    session.publishableKey ? session : { ...session, publishableKey: env.stripePublishableKey ?? "" }, []);

  const invoicePayment = useMemo<PaymentLoaders>(
    () => ({
      getOptions: (doc) => getPaymentOptions(token, doc.id),
      start: async (doc, body) => withKey(await startPayment(token, doc.id, body)),
      getStatus: (paymentId) => getPaymentStatus(token, paymentId),
    }),
    [token, withKey],
  );

  const depositPayment = useMemo<PaymentLoaders>(
    () => ({
      getOptions: (doc) => getDepositOptions(token, doc.id),
      start: async (doc, body) => withKey(await startDeposit(token, doc.id, body)),
      getStatus: (paymentId) => getPaymentStatus(token, paymentId),
    }),
    [token, withKey],
  );

  const returnUrl = useCallback(
    (paymentId: string, documentId: string) =>
      `${window.location.origin}${window.location.pathname}?${PAYMENT_PARAM}=${encodeURIComponent(paymentId)}&${INVOICE_PARAM}=${encodeURIComponent(documentId)}`,
    [],
  );

  const reload = portal.reload;
  const closePanel = useCallback(() => {
    setPanel(null);
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
  const signerName = [view.client.firstName, view.client.lastName].filter(Boolean).join(" ");
  // Deciding and paying are for real clients only: the staff preview reads, it does not act.
  const actions: PortalActions = view.preview
    ? {}
    : {
        onApprove: (doc) => setPanel({ kind: "approve", doc }),
        onDecline: (doc) => setPanel({ kind: "decline", doc }),
        onPay: (doc) => setPanel({ kind: doc.signatureNeeded ? "sign-invoice" : "pay", doc }),
        onPayDeposit: (doc) => setPanel({ kind: "deposit", doc }),
      };

  // Back from Stripe: the id in the URL names an invoice (its balance) or an estimate (its deposit).
  const resumeInvoice = resume ? view.invoices.find((i) => i.id === resume.documentId) : undefined;
  const resumeEstimate = resume && !resumeInvoice ? view.estimates.find((e) => e.id === resume.documentId) : undefined;
  const resumeDoc = resume ? (resumeInvoice ?? resumeEstimate ?? stubInvoice(resume.documentId)) : null;

  const signAndReload = async (doc: PortalDocumentSummary, input: { imageDataUrl: string; signedBy: string }) => {
    if (doc.kind === "estimate") await approveEstimate(token, doc.id, input);
    else await signInvoice(token, doc.id, input);
    reload();
  };

  return (
    <>
      <PortalView view={view} loaders={loaders} actions={actions} scope={`token:${token}`} />

      {resumeDoc ? (
        <PaymentPanel
          key={`resume:${resume?.paymentId}`}
          doc={resumeDoc}
          loaders={resumeEstimate ? depositPayment : invoicePayment}
          onClose={closePanel}
          onPaid={reload}
          businessName={view.business.name}
          returnUrl={(paymentId) => returnUrl(paymentId, resumeDoc.id)}
          resumePaymentId={resume?.paymentId}
          noun={resumeEstimate ? "deposit" : "invoice"}
        />
      ) : panel?.kind === "approve" ? (
        <SignAndPayPanel
          key={`approve:${panel.doc.id}`}
          doc={panel.doc}
          mode="approve"
          signerName={signerName}
          onSign={(input) => signAndReload(panel.doc, input)}
          payment={
            (panel.doc.depositDue ?? 0) > 0
              ? { loaders: depositPayment, returnUrl: (id) => returnUrl(id, panel.doc.id), noun: "deposit", onPaid: reload }
              : undefined
          }
          onClose={closePanel}
          businessName={view.business.name}
        />
      ) : panel?.kind === "sign-invoice" ? (
        <SignAndPayPanel
          key={`sign:${panel.doc.id}`}
          doc={panel.doc}
          mode="sign-invoice"
          signerName={signerName}
          alreadySigned={panel.doc.signed === true}
          onSign={(input) => signAndReload(panel.doc, input)}
          payment={{ loaders: invoicePayment, returnUrl: (id) => returnUrl(id, panel.doc.id), noun: "invoice", onPaid: reload }}
          onClose={closePanel}
          businessName={view.business.name}
        />
      ) : panel?.kind === "pay" || panel?.kind === "deposit" ? (
        <PaymentPanel
          key={`${panel.kind}:${panel.doc.id}`}
          doc={panel.doc}
          loaders={panel.kind === "deposit" ? depositPayment : invoicePayment}
          onClose={closePanel}
          onPaid={reload}
          businessName={view.business.name}
          returnUrl={(paymentId) => returnUrl(paymentId, panel.doc.id)}
          noun={panel.kind === "deposit" ? "deposit" : "invoice"}
        />
      ) : panel?.kind === "decline" ? (
        <DeclineDialog
          doc={panel.doc}
          onCancel={closePanel}
          onDecline={async (reason) => {
            await declineEstimate(token, panel.doc.id, reason ? { reason } : {});
            closePanel();
            reload();
          }}
        />
      ) : null}
    </>
  );
}

/** Workiz "Decline": an optional reason, then the estimate is declined. */
function DeclineDialog({
  doc,
  onCancel,
  onDecline,
}: {
  doc: PortalDocumentSummary;
  onCancel: () => void;
  onDecline: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDecline(reason.trim());
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "We couldn't decline this estimate. Please try again.");
      setBusy(false);
    }
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Decline estimate #${doc.number}`}
      className="fixed inset-0 z-60 flex items-end justify-center bg-[#3b4b52]/45 p-4 font-sans text-[#3b4b52] sm:items-center"
    >
      <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-[0_12px_40px_rgba(59,75,82,0.25)]">
        <h2 className="text-xl font-semibold">Decline estimate #{doc.number}?</h2>
        <p className="text-sm text-[#637075]">Let us know why, if you like — it helps us do better.</p>
        <label htmlFor="decline-reason" className="sr-only">
          Reason
        </label>
        <textarea
          id="decline-reason"
          rows={3}
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          className="w-full rounded-lg border border-[#e9ebec] bg-white p-3 text-sm placeholder:text-[#9ea6aa] focus-visible:ring-2 focus-visible:ring-[#6aa8ee] focus-visible:outline-none"
        />
        {error ? (
          <p role="alert" className="text-sm text-[#e05c5c]">{error}</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-10 items-center rounded-full border border-[#3b4b52]/70 bg-white px-5 text-sm font-semibold hover:bg-[#f3f4f5] disabled:opacity-60"
          >
            Keep it
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="inline-flex h-10 items-center rounded-full bg-[#e05c5c] px-5 text-sm font-semibold text-white hover:bg-[#d14f4f] disabled:opacity-60"
          >
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}

/** A returning customer whose invoice has since dropped off the portal still deserves an answer. */
function stubInvoice(id: string): PortalDocumentSummary {
  return { kind: "invoice", id, number: "", date: "", status: "due", total: 0, sent: true };
}
