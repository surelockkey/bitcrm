"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type { PortalDocumentSummary } from "@bitcrm/types";
import { primaryButton } from "./document-viewer";
import { Drawer, StepBadge } from "./drawer";
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

const SOFT = "text-[#637075]";

/**
 * Workiz "Sign & Pay", as its drawer lays it out: step 1 "Add your signature"
 * on the grey sheet, step 2 "Make a deposit" (or pay the invoice) as the white
 * card that rises from the bottom. Always in that order — the signature is
 * what approves an estimate, and money is only taken after it.
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
  const [editingName, setEditingName] = useState(!signerName.trim());
  const [image, setImage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <Drawer title={title} onClose={onClose}>
      <div className="flex min-h-full flex-col">
        {/* Step 1 */}
        <section aria-label="Add your signature" className="px-5 pt-5 pb-5">
          <div className="flex items-center gap-3">
            <StepBadge n={1} done={signed} />
            <h3 className="flex-1 text-xl font-semibold">Add your signature</h3>
            {signed ? (
              <>
                <span className={cx("text-xs font-medium", SOFT)}>Signed</span>
                <ChevronDown className={cx("size-5", SOFT)} aria-hidden />
              </>
            ) : (
              <ChevronRight className="size-5" aria-hidden />
            )}
          </div>
          {!signed ? (
            <div className="mt-4 space-y-4">
              <p className={cx("text-sm", SOFT)}>
                {mode === "approve" ? `Estimate #${doc.number}` : `Invoice #${doc.number}`}
                {doc.name ? ` · ${doc.name}` : ""} · {formatMoney(doc.total)}
              </p>
              <div>
                <span className="inline-block border-b-[3px] border-[#50d58c] px-1 pb-1 text-sm font-semibold">Sign</span>
                <SignaturePad onChange={setImage} disabled={saving} />
              </div>
              {editingName ? (
                <div className="space-y-1.5">
                  <label htmlFor="sign-name" className="text-sm font-medium">
                    Your name
                  </label>
                  <input
                    id="sign-name"
                    value={name}
                    maxLength={120}
                    onChange={(e) => setName(e.target.value)}
                    className="h-10 w-full rounded-lg border border-[#e9ebec] bg-white px-3 text-sm focus-visible:ring-2 focus-visible:ring-[#6aa8ee] focus-visible:outline-none"
                  />
                </div>
              ) : (
                <p className={cx("text-xs", SOFT)}>
                  Signing as <span className="font-semibold text-[#3b4b52]">{name}</span>.{" "}
                  <button type="button" onClick={() => setEditingName(true)} className="text-[#6aa8ee] hover:underline">
                    Not you?
                  </button>
                </p>
              )}
              {error ? (
                <p role="alert" className="rounded-lg border border-[#e05c5c]/40 bg-[#fdecec] p-3 text-sm text-[#e05c5c]">
                  {error}
                </p>
              ) : null}
              <p className={cx("text-xs", SOFT)}>
                {mode === "approve"
                  ? `By signing you approve this estimate from ${businessName ?? "us"}.`
                  : `${businessName ?? "The business"} asked for your signature on this invoice before payment.`}
              </p>
              <div className="flex justify-end">
                <button type="button" onClick={sign} disabled={!image || !name.trim() || saving} className={cx(primaryButton, "h-12 px-8 text-base")}>
                  {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                  {payment ? "Continue" : mode === "approve" ? "Approve" : "Sign"}
                </button>
              </div>
            </div>
          ) : null}
        </section>

        {/* Step 2: the white card at the bottom (Workiz). */}
        {payment && stepTwo ? (
          <section
            aria-label={stepTwo}
            className="mt-auto rounded-t-3xl bg-white px-5 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-[0_-6px_20px_rgba(59,75,82,0.10)]"
          >
            <div className="flex items-center gap-3">
              <StepBadge n={2} done={false} />
              <h3 className="flex-1 text-xl font-semibold">{stepTwo}</h3>
              {signed ? <ChevronRight className="size-5" aria-hidden /> : <ChevronDown className={cx("size-5", SOFT)} aria-hidden />}
            </div>
            {signed ? (
              <div className="mt-5 space-y-4">
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
              <p className={cx("mt-2 text-xs", SOFT)}>Sign first — the payment comes after.</p>
            )}
          </section>
        ) : signed ? (
          <div className="mt-auto rounded-t-3xl bg-white px-5 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-[0_-6px_20px_rgba(59,75,82,0.10)]">
            <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 rounded-lg border border-[#50d58c]/40 bg-[#eefbf4] p-8 text-center">
              <CheckCircle2 className="size-7 text-[#50d58c]" aria-hidden />
              <p className="text-base font-semibold">{mode === "approve" ? "Estimate approved — thank you!" : "Signed — thank you!"}</p>
              <p className={cx("text-sm", SOFT)}>
                {businessName ?? "The business"} has been notified{mode === "approve" ? " and will be in touch about the work." : "."}
              </p>
              <button type="button" onClick={onClose} className={primaryButton}>
                Done
              </button>
            </div>
          </div>
        ) : null}

        {!signed && !payment ? null : (
          <p className={cx("bg-white px-5 pb-4 text-center text-xs", SOFT)}>
            <AlertCircle className="mr-1 inline size-3.5" aria-hidden /> Your signature is kept with the document as proof of approval.
          </p>
        )}
      </div>
    </Drawer>
  );
}
