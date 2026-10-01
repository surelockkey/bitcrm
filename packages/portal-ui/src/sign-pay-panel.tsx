"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, CheckCircle2, ChevronRight, Loader2, Lock, X } from "lucide-react";
import type { PortalDocumentSummary } from "@bitcrm/types";
import { primaryButton } from "./document-viewer";
import { cx, formatMoney } from "./lib";
import { PaymentPanelBody, type PaymentLoaders } from "./payment-panel";
import { SignaturePad } from "./signature-pad";

export interface SignAndPayPayment {
  loaders: PaymentLoaders;
  returnUrl: (paymentId: string) => string;
  /** An invoice's balance, or an estimate's deposit. */
  noun: "invoice" | "deposit";
  /** Called once money has moved, so the portal can re-read its balances. */
  onPaid: () => void;
}

export interface SignAndPayPanelProps {
  doc: PortalDocumentSummary;
  /** `approve`: an estimate is approved by signing it. `sign-invoice`: Workiz "Request signature" before paying. */
  mode: "approve" | "sign-invoice";
  /** Pre-filled "Signed by": the client's name. */
  signerName: string;
  /** Stores the signature (approving the estimate / signing the invoice). Rejects with a message to show. */
  onSign: (input: { imageDataUrl: string; signedBy: string }) => Promise<void>;
  /** Step 2. Absent ⇒ there is nothing to pay after signing (an estimate with no deposit). */
  payment?: SignAndPayPayment;
  /** Already signed earlier (the invoice was signed, the estimate approved): skip straight to paying. */
  alreadySigned?: boolean;
  onClose: () => void;
  businessName?: string;
}

/**
 * Workiz "Sign & Pay": step 1 "Add your signature", step 2 "Make a deposit"
 * (or pay the invoice). Always in that order — the signature is what approves
 * an estimate, and money is only taken after it. Full screen, like the
 * payment panel: a phone has no room for a modal-in-a-modal.
 */
export function SignAndPayPanel({
  doc,
  mode,
  signerName,
  onSign,
  payment,
  alreadySigned = false,
  onClose,
  businessName,
}: SignAndPayPanelProps) {
  const [signed, setSigned] = useState(alreadySigned);
  const [name, setName] = useState(signerName);
  const [image, setImage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    close.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const title = payment ? (mode === "approve" ? "Sign & Pay" : "Sign & pay invoice") : "Approve estimate";
  const stepTwo = payment ? (payment.noun === "deposit" ? "Make a deposit" : "Pay the invoice") : null;

  const sign = async () => {
    if (!image || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSign({ imageDataUrl: image, signedBy: name.trim() });
      setSigned(true);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "We couldn't save your signature. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-60 flex flex-col bg-background">
      <header className="border-b bg-card pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex w-full max-w-lg items-center gap-3 px-3 py-2.5 sm:px-5">
          <button
            ref={close}
            type="button"
            onClick={onClose}
            aria-label="Close and go back"
            className="-ml-1 inline-flex size-10 flex-none items-center justify-center rounded-lg hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X className="size-5" aria-hidden />
          </button>
          <h2 className="min-w-0 flex-1 truncate text-base leading-tight font-semibold">{title}</h2>
          <span className="inline-flex flex-none items-center gap-1 text-xs text-muted-foreground">
            <Lock className="size-3.5" aria-hidden /> Secure
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-lg space-y-4 p-4 sm:p-6">
          <p className="text-sm text-muted-foreground">
            {mode === "approve" ? `Estimate #${doc.number}` : `Invoice #${doc.number}`}
            {doc.name ? ` · ${doc.name}` : ""} · {formatMoney(doc.total)}
          </p>

          {/* Step 1 */}
          <section aria-label="Add your signature" className={cx("rounded-2xl border bg-card shadow-xs", signed && "opacity-90")}>
            <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <StepBadge n={1} done={signed} />
              <h3 className="flex-1 text-base font-semibold">Add your signature</h3>
              {signed ? <span className="text-xs text-emerald-700 dark:text-emerald-400">Signed</span> : <ChevronRight className="size-4 text-muted-foreground" aria-hidden />}
            </div>
            {!signed ? (
              <div className="space-y-3 border-t px-4 py-4 sm:px-5">
                <div className="space-y-1.5">
                  <label htmlFor="sign-name" className="text-sm font-medium">
                    Your name
                  </label>
                  <input
                    id="sign-name"
                    value={name}
                    maxLength={120}
                    onChange={(e) => setName(e.target.value)}
                    className="h-10 w-full rounded-lg border bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  />
                </div>
                <SignaturePad onChange={setImage} disabled={saving} />
                {error ? (
                  <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {mode === "approve"
                    ? `By signing you approve this estimate from ${businessName ?? "us"}.`
                    : `${businessName ?? "The business"} asked for your signature on this invoice before payment.`}
                </p>
                <button type="button" onClick={sign} disabled={!image || !name.trim() || saving} className={cx(primaryButton, "w-full")}>
                  {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
                  {payment ? "Continue" : mode === "approve" ? "Approve" : "Sign"}
                </button>
              </div>
            ) : null}
          </section>

          {/* Step 2 */}
          {payment && stepTwo ? (
            <section aria-label={stepTwo} className={cx("rounded-2xl border bg-card shadow-xs", !signed && "opacity-60")}>
              <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <StepBadge n={2} done={false} />
                <h3 className="flex-1 text-base font-semibold">{stepTwo}</h3>
              </div>
              {signed ? (
                <div className="space-y-4 border-t px-4 py-4 sm:px-5">
                  <PaymentPanelBody
                    doc={doc}
                    loaders={payment.loaders}
                    onClose={onClose}
                    onPaid={payment.onPaid}
                    businessName={businessName}
                    returnUrl={payment.returnUrl}
                    noun={payment.noun}
                  />
                </div>
              ) : (
                <p className="border-t px-4 py-3 text-xs text-muted-foreground sm:px-5">Sign first — the payment comes after.</p>
              )}
            </section>
          ) : signed ? (
            <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8 text-center">
              <CheckCircle2 className="size-6 text-emerald-600" aria-hidden />
              <p className="text-base font-semibold">{mode === "approve" ? "Estimate approved — thank you!" : "Signed — thank you!"}</p>
              <p className="text-sm text-muted-foreground">
                {businessName ?? "The business"} has been notified{mode === "approve" ? " and will be in touch about the work." : "."}
              </p>
              <button type="button" onClick={onClose} className={primaryButton}>
                Done
              </button>
            </div>
          ) : null}

          {!signed && !payment ? null : (
            <p className="text-center text-xs text-muted-foreground">
              <AlertCircle className="mr-1 inline size-3.5" aria-hidden /> Your signature is kept with the document as proof of approval.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function StepBadge({ n, done }: { n: number; done: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "flex size-6 flex-none items-center justify-center rounded-full text-xs font-semibold",
        done ? "bg-emerald-500 text-white" : "bg-brand/15 text-brand",
      )}
    >
      {done ? <Check className="size-3.5" /> : n}
    </span>
  );
}
