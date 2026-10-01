"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Building2, CheckCircle2, Clock, CreditCard, Loader2, Lock } from "lucide-react";
import type { Stripe } from "@stripe/stripe-js";
import { loadStripe } from "@stripe/stripe-js/pure";
import { CheckoutElementsProvider, PaymentElement, useCheckoutElements } from "@stripe/react-stripe-js/checkout";
import type {
  OnlinePaymentMethod,
  PortalDocumentSummary,
  PortalPaymentOptions,
  PortalPaymentSession,
} from "@bitcrm/types";
import { primaryButton, outlineButton } from "./document-viewer";
import { Drawer } from "./drawer";
import { TONE_BADGE, TONE_PANEL, TONE_TEXT, cx, formatMoney, isInvalidPortalError } from "./lib";
import {
  MAX_STATUS_POLLS,
  STATUS_POLL_MS,
  checkAmount,
  computeTotals,
  confirmErrorCopy,
  defaultMethod,
  methodChoices,
  outcomeCopy,
  outcomeOfStatus,
  payableOnline,
  startErrorCopy,
  type PaymentOutcome,
  type PortalPaymentStatus,
} from "./payment-lib";
import { useLoad } from "./use-load";

/* ------------------------------------------------------------------- stripe */

/**
 * `@stripe/stripe-js/pure` does not fetch js.stripe.com on import — only
 * `loadStripe` does, so the script is requested the first time a customer
 * actually opens a payment. The promise is cached at module scope (never in a
 * component, which would re-create it on every render); it is keyed because the
 * publishable key arrives with the session, so there is nothing to call
 * `loadStripe` with until then.
 */
const stripeByKey = new Map<string, Promise<Stripe | null>>();

function getStripe(publishableKey: string): Promise<Stripe | null> {
  const cached = stripeByKey.get(publishableKey);
  if (cached) return cached;
  const promise = loadStripe(publishableKey);
  stripeByKey.set(publishableKey, promise);
  return promise;
}

/* -------------------------------------------------------------------- types */

/** How a host app talks to the payment endpoints (the portal by token). */
export interface PaymentLoaders {
  /** `GET …/invoice/:id/payment-options` */
  getOptions: (doc: PortalDocumentSummary) => Promise<PortalPaymentOptions>;
  /** `POST …/invoice/:id/pay` — the amount is clamped again server-side. */
  start: (doc: PortalDocumentSummary, body: { amount: number; method: OnlinePaymentMethod }) => Promise<PortalPaymentSession>;
  /** `GET …/payment/:paymentId` — polled after a payment, never in a loop. */
  getStatus: (paymentId: string) => Promise<PortalPaymentStatus>;
}

export interface PaymentPanelProps {
  doc: PortalDocumentSummary;
  loaders: PaymentLoaders;
  onClose: () => void;
  /** Called once money has moved, so the portal can re-read its balances. */
  onPaid: () => void;
  businessName?: string;
  /** Where Stripe sends a customer back to after a redirect-based method. */
  returnUrl: (paymentId: string) => string;
  /** Set when the page was opened by that redirect: skip to the poll. */
  resumePaymentId?: string;
  /** What is being paid: an invoice's balance (default) or an estimate's deposit. Only the copy changes. */
  noun?: "invoice" | "deposit";
}

type Step =
  | { kind: "form" }
  | { kind: "starting" }
  | { kind: "pay"; session: PortalPaymentSession }
  | { kind: "polling"; paymentId: string; amount: number }
  | { kind: "done"; outcome: PaymentOutcome; amount: number };

/* --------------------------------------------------------------------- shell */

const label = "text-sm font-medium";
const hint = "text-xs text-[#637075]";
const caption = "text-[11px] font-semibold tracking-wide text-[#637075] uppercase";

/** Workiz's drawer, with the states inside its white card. */
export function PaymentPanel(props: PaymentPanelProps) {
  const { doc, onClose } = props;
  // Coming back from a redirect there is nothing left to choose — the page is a receipt.
  const title = props.resumePaymentId
    ? "Your payment"
    : props.noun === "deposit"
      ? `Deposit for estimate #${doc.number}`
      : `Pay invoice #${doc.number}`;
  return (
    <Drawer title={title} onClose={onClose}>
      <div className="flex min-h-full flex-col">
        <div className="mt-auto space-y-4 rounded-t-3xl bg-white px-5 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-[0_-6px_20px_rgba(59,75,82,0.10)]">
          <PanelBody {...props} />
        </div>
      </div>
    </Drawer>
  );
}

/* ---------------------------------------------------------------- the states */

/** The states of a payment without the full-screen shell — the Sign & Pay panel embeds it as its second step. */
export function PaymentPanelBody(props: PaymentPanelProps) {
  return <PanelBody {...props} />;
}

function PanelBody({ doc, loaders, onClose, onPaid, businessName, returnUrl, resumePaymentId, noun = "invoice" }: PaymentPanelProps) {
  const [step, setStep] = useState<Step>(
    resumePaymentId ? { kind: "polling", paymentId: resumePaymentId, amount: doc.balanceDue ?? 0 } : { kind: "form" },
  );
  // Resuming from a redirect, the options are irrelevant: the money already moved.
  const options = useLoad(
    () => (resumePaymentId ? Promise.resolve(null) : loaders.getOptions(doc)),
    `${doc.kind}:${doc.id}:${resumePaymentId ?? ""}`,
  );

  const finish = useCallback(
    (outcome: PaymentOutcome, amount: number) => {
      setStep({ kind: "done", outcome, amount });
      if (outcome === "settled" || outcome === "pending" || outcome === "unknown") onPaid();
    },
    [onPaid],
  );

  if (step.kind === "polling") {
    return <PollingState paymentId={step.paymentId} amount={step.amount} getStatus={loaders.getStatus} onDone={finish} />;
  }
  if (step.kind === "done") {
    return <DoneState outcome={step.outcome} amount={step.amount} onClose={onClose} />;
  }

  if (options.loading && !options.data) return <PanelSkeleton />;
  if (options.error || !options.data) {
    if (isInvalidPortalError(options.error)) {
      return (
        <Notice tone="muted" icon={<AlertCircle className="size-6" aria-hidden />} title="This link is no longer valid">
          We couldn&apos;t open this invoice for payment. Please ask
          {businessName ? ` ${businessName}` : " the business that sent it"} for a fresh link.
        </Notice>
      );
    }
    return (
      <Notice
        tone="muted"
        icon={<AlertCircle className="size-6" aria-hidden />}
        title="We couldn't load the payment page"
        action={
          <button type="button" onClick={options.reload} disabled={options.loading} className={outlineButton}>
            Try again
          </button>
        }
      >
        Check your connection and try again. Nothing has been charged.
      </Notice>
    );
  }

  const opts = options.data;

  if (opts.amountDue <= 0) {
    return (
      <Notice tone="good" icon={<CheckCircle2 className="size-6" aria-hidden />} title={noun === "deposit" ? "This deposit is paid" : "This invoice is settled"}>
        Thank you — there&apos;s nothing left to pay on {noun === "deposit" ? "the deposit for estimate" : "invoice"} #{opts.number}.
        {opts.amountPending > 0 ? ` A bank payment of ${formatMoney(opts.amountPending)} is still clearing.` : ""}
      </Notice>
    );
  }
  if (!payableOnline(opts)) {
    return (
      <Notice tone="muted" icon={<Building2 className="size-6" aria-hidden />} title="Online payment isn't available here">
        {formatMoney(opts.amountDue)} is owed on {noun === "deposit" ? "the deposit for estimate" : "invoice"} #{opts.number}, but{" "}
        {businessName ?? "the business that sent this"} doesn&apos;t take card or bank payments through this page. Please
        contact {businessName ?? "them"} to arrange payment.
      </Notice>
    );
  }

  return (
    <PayFlow
      doc={doc}
      options={opts}
      step={step}
      setStep={setStep}
      loaders={loaders}
      returnUrl={returnUrl}
      onDone={finish}
      businessName={businessName}
      noun={noun}
    />
  );
}

/* ------------------------------------------------------------- amount + pay */

function PayFlow({
  doc,
  options,
  step,
  setStep,
  loaders,
  returnUrl,
  onDone,
  businessName,
  noun = "invoice",
}: {
  doc: PortalDocumentSummary;
  options: PortalPaymentOptions;
  step: Step;
  setStep: (s: Step) => void;
  loaders: PaymentLoaders;
  returnUrl: (paymentId: string) => string;
  onDone: (outcome: PaymentOutcome, amount: number) => void;
  businessName?: string;
  noun?: "invoice" | "deposit";
}) {
  const [raw, setRaw] = useState(() => options.amountDue.toFixed(2));
  const [touched, setTouched] = useState(false);
  const [method, setMethod] = useState<OnlinePaymentMethod | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const amountInput = useRef<HTMLInputElement>(null);

  const { amount, error } = useMemo(() => checkAmount(raw, options), [raw, options]);
  const choices = useMemo(() => methodChoices(options, amount), [options, amount]);
  const chosen = useMemo(() => {
    const fallback = defaultMethod(choices);
    const picked = choices.find((c) => c.value === method && !c.disabled);
    return picked?.value ?? fallback;
  }, [choices, method]);
  const totals = computeTotals(amount ?? 0, options.surchargePercent);

  const onPayStep = step.kind === "pay";
  const session = step.kind === "pay" ? step.session : null;

  const start = async () => {
    if (amount === null || !chosen) {
      setTouched(true);
      amountInput.current?.focus();
      return;
    }
    setStartError(null);
    setStep({ kind: "starting" });
    try {
      const created = await loaders.start(doc, { amount, method: chosen });
      if (!created.clientSecret || !created.publishableKey) throw new Error("incomplete payment session");
      setStep({ kind: "pay", session: created });
    } catch (e) {
      setStep({ kind: "form" });
      setStartError(startErrorCopy(e));
    }
  };

  const backToAmount = () => {
    setStep({ kind: "form" });
    setStartError(null);
    requestAnimationFrame(() => amountInput.current?.focus());
  };

  const showError = touched && error !== null;

  return (
    <>
      <section className="space-y-5">
        <div className="space-y-1">
          <p aria-hidden className={caption}>
            Amount due
          </p>
          <label htmlFor="pay-amount" className="sr-only">
            Amount to pay
          </label>
          <div className={cx("flex items-baseline gap-1", showError && "text-[#e05c5c]", onPayStep && "opacity-60")}>
            <span aria-hidden className="text-2xl font-semibold">
              $
            </span>
            <input
              id="pay-amount"
              ref={amountInput}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="done"
              value={raw}
              readOnly={!options.allowPartial || onPayStep}
              aria-invalid={showError || undefined}
              aria-describedby="pay-amount-help"
              style={{ width: `${Math.max(4, raw.length + 1)}ch` }}
              onChange={(e) => {
                setRaw(e.target.value);
                setTouched(true);
              }}
              onBlur={() => {
                setTouched(true);
                if (amount !== null) setRaw(amount.toFixed(2));
              }}
              className={cx(
                "min-w-0 border-b-2 border-transparent bg-transparent text-2xl font-semibold tabular-nums outline-none",
                options.allowPartial && !onPayStep && "focus-visible:border-[#6aa8ee]",
              )}
            />
            <span className="text-xl text-[#637075]">/ {formatMoney(options.amountDue)}</span>
          </div>
          <p id="pay-amount-help" className={showError ? "text-xs text-[#e05c5c]" : hint} role={showError ? "alert" : undefined}>
            {showError
              ? error
              : options.allowPartial
                ? `You can pay any part of the ${formatMoney(options.amountDue)} ${noun === "deposit" ? "deposit" : "balance"}.`
                : `This ${noun} is paid in one go — the full ${formatMoney(options.amountDue)}.`}
          </p>
          {options.amountPending > 0 ? (
            <p className={hint}>
              {formatMoney(options.amountPending)} is already on its way from your bank and isn&apos;t counted here.
            </p>
          ) : null}
        </div>

        {choices.length > 1 ? (
          <fieldset disabled={onPayStep} className="space-y-3">
            <legend className="sr-only">How would you like to pay?</legend>
            <div aria-hidden className={cx("flex items-center gap-3", caption)}>
              <span className="h-px flex-1 bg-[#e9ebec]" />
              Pay with
              <span className="h-px flex-1 bg-[#e9ebec]" />
            </div>
            <div role="radiogroup" aria-label="How would you like to pay?" className="grid grid-cols-2 gap-3">
              {choices.map((choice) => (
                <label
                  key={choice.value}
                  className={cx(
                    "flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-[#e9ebec] px-3 py-3 text-center text-[#637075] transition-colors has-checked:border-[#6aa8ee] has-checked:bg-[#eef5fd] has-checked:text-[#3b4b52] has-focus-visible:ring-2 has-focus-visible:ring-[#6aa8ee]",
                    choice.disabled && "cursor-not-allowed opacity-60",
                  )}
                >
                  <input
                    type="radio"
                    name="pay-method"
                    value={choice.value}
                    checked={chosen === choice.value}
                    disabled={choice.disabled || onPayStep}
                    onChange={() => setMethod(choice.value)}
                    className="sr-only"
                  />
                  {choice.value === "bank" ? <Building2 className="size-5" aria-hidden /> : <CreditCard className="size-5" aria-hidden />}
                  <span className="text-sm font-medium">{choice.label}</span>
                  <span className="text-xs">{choice.description}</span>
                  {choice.reason ? <span className={`block text-xs ${TONE_TEXT.warning}`}>{choice.reason}</span> : null}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <Summary
          amount={session ? session.amount : totals.amount}
          fee={session ? session.surcharge : totals.fee}
          total={session ? session.total : totals.total}
          feeLabel={options.surchargeLabel}
        />
      </section>

      {startError ? (
        <p role="alert" className="rounded-lg border border-[#e05c5c]/40 bg-[#fdecec] p-3 text-sm text-[#e05c5c]">
          {startError}
        </p>
      ) : null}

      {session ? (
        <CheckoutElementsProvider
          key={session.clientSecret}
          stripe={getStripe(session.publishableKey)}
          options={{ clientSecret: session.clientSecret }}
        >
          <PayStep session={session} returnUrl={returnUrl} onDone={onDone} onChangeAmount={backToAmount} />
        </CheckoutElementsProvider>
      ) : (
        <button type="button" onClick={start} disabled={amount === null || step.kind === "starting"} className={cx(primaryButton, "w-full")}>
          {step.kind === "starting" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Lock className="size-4" aria-hidden />}
          Continue to payment
        </button>
      )}

      <p className={cx(hint, "flex items-start justify-center gap-2 text-left")}>
        <Lock className="mt-0.5 size-4 flex-none text-[#9ea6aa]" aria-hidden />
        <span>Payments are handled by Stripe. {businessName ?? "We"} never sees your card details.</span>
      </p>
    </>
  );
}

function Summary({ amount, fee, total, feeLabel }: { amount: number; fee: number; total: number; feeLabel: string }) {
  return (
    <div role="group" aria-label="Payment summary" className="divide-y divide-[#e9ebec] border-t border-[#e9ebec] text-sm">
      <Row label="Amount" value={amount} />
      {fee > 0 ? <Row label={feeLabel} value={fee} /> : null}
      <Row label="Total" value={total} strong />
    </div>
  );
}

function Row({ label: text, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <span className={cx("text-[11px] tracking-wide uppercase", strong ? "font-semibold" : "text-[#637075]")}>{text}</span>
      <span className={cx("tabular-nums", strong ? "text-base font-semibold" : "text-sm")}>{formatMoney(value)}</span>
    </div>
  );
}

/* ------------------------------------------------------- the Stripe Element */

function PayStep({
  session,
  returnUrl,
  onDone,
  onChangeAmount,
}: {
  session: PortalPaymentSession;
  returnUrl: (paymentId: string) => string;
  onDone: (outcome: PaymentOutcome, amount: number) => void;
  onChangeAmount: () => void;
}) {
  const checkout = useCheckoutElements();
  const [submitting, setSubmitting] = useState(false);
  const [declined, setDeclined] = useState<{ title: string; detail: string } | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (declined) alertRef.current?.focus();
  }, [declined]);

  const pay = async () => {
    if (checkout.type !== "success") return;
    setSubmitting(true);
    setDeclined(null);
    try {
      const result = await checkout.checkout.confirm({ returnUrl: returnUrl(session.paymentId), redirect: "if_required" });
      if (result.type === "error") {
        setDeclined(confirmErrorCopy(result.error?.message));
        return;
      }
      const status = result.session?.status;
      if (status?.type === "complete") {
        onDone(status.paymentStatus === "paid" ? "settled" : "pending", session.total);
        return;
      }
      // Confirmed but not yet complete (a redirect method came straight back):
      // let the ledger tell us, rather than guessing.
      onDone("unknown", session.total);
    } catch {
      setDeclined({
        title: "We lost the connection",
        detail: "We couldn't reach the payment service. Check your connection and try again — nothing has been charged.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const failed = checkout.type === "error";

  return (
    <section className="space-y-3">
      {declined ? (
        <div
          ref={alertRef}
          tabIndex={-1}
          role="alert"
          className="space-y-1 rounded-lg border border-[#e05c5c]/40 bg-[#fdecec] p-3 focus-visible:ring-2 focus-visible:ring-[#6aa8ee] focus-visible:outline-none"
        >
          <p className="text-sm font-semibold text-[#e05c5c]">{declined.title}</p>
          <p className="text-sm text-[#e05c5c]/90">{declined.detail}</p>
        </div>
      ) : null}

      {/* A fixed floor, so the card fields dropping in never shove the button. */}
      <div className="min-h-[248px] rounded-lg border border-[#e9ebec] bg-white p-4">
        {failed ? (
          <p className="text-sm text-[#637075]">
            We couldn&apos;t load the secure card form. Please refresh the page and try again, or pay by another means.
          </p>
        ) : (
          <>
            {checkout.type === "loading" ? (
              <div role="status" aria-label="Loading the secure card form" className="space-y-3">
                <div className="h-10 animate-pulse rounded-lg bg-[#f3f4f5]" />
                <div className="h-10 animate-pulse rounded-lg bg-[#f3f4f5]" />
                <div className="h-10 w-2/3 animate-pulse rounded-lg bg-[#f3f4f5]" />
              </div>
            ) : null}
            <div className={checkout.type === "loading" ? "hidden" : undefined}>
              <PaymentElement options={{ layout: "tabs" }} />
            </div>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={pay}
        disabled={submitting || checkout.type !== "success"}
        className={cx(primaryButton, "w-full")}
      >
        {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Lock className="size-4" aria-hidden />}
        {submitting ? "Paying…" : `Pay ${formatMoney(session.total)}`}
      </button>
      <button type="button" onClick={onChangeAmount} disabled={submitting} className={cx(outlineButton, "w-full")}>
        Change the amount
      </button>
    </section>
  );
}

/* --------------------------------------------------------------- the ending */

/**
 * The webhook is usually here before the customer is, but not always. Ten
 * tries, two seconds apart, then we stop and promise an email instead of
 * spinning forever.
 */
function PollingState({
  paymentId,
  amount,
  getStatus,
  onDone,
}: {
  paymentId: string;
  amount: number;
  getStatus: (id: string) => Promise<PortalPaymentStatus>;
  onDone: (outcome: PaymentOutcome, amount: number) => void;
}) {
  const done = useRef(onDone);
  done.current = onDone;
  const load = useRef(getStatus);
  load.current = getStatus;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      for (let attempt = 0; attempt < MAX_STATUS_POLLS && !cancelled; attempt++) {
        try {
          const status = await load.current(paymentId);
          if (cancelled) return;
          const outcome = outcomeOfStatus(status.status);
          // A card sitting at `pending` just means the webhook is late; a bank
          // payment sitting at `pending` is the answer — it takes days.
          if (outcome !== "pending" || status.method === "bank") {
            done.current(outcome, status.amount || amount);
            return;
          }
        } catch {
          // The ledger row may not exist yet. Keep waiting, within the budget.
        }
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, STATUS_POLL_MS);
        });
      }
      if (!cancelled) done.current("unknown", amount);
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [paymentId, amount]);

  return (
    <div role="status" className="flex flex-col items-center gap-3 rounded-lg border border-[#e9ebec] bg-white p-8 text-center">
      <Loader2 className="size-6 animate-spin text-[#637075]" aria-hidden />
      <p className="text-sm font-medium">Confirming your payment…</p>
      <p className={hint}>This takes a few seconds. Please don&apos;t close this page or pay again.</p>
    </div>
  );
}

function DoneState({ outcome, amount, onClose }: { outcome: PaymentOutcome; amount: number; onClose: () => void }) {
  const copy = outcomeCopy(outcome, amount);
  const good = outcome === "settled";
  const bad = outcome === "failed";
  return (
    <Notice
      tone={bad ? "bad" : good ? "good" : "muted"}
      icon={bad ? <AlertCircle className="size-6" aria-hidden /> : good ? <CheckCircle2 className="size-6" aria-hidden /> : <Clock className="size-6" aria-hidden />}
      title={copy.title}
      action={
        <button type="button" onClick={onClose} className={good || !bad ? primaryButton : outlineButton}>
          {bad ? "Back to the invoice" : "Done"}
        </button>
      }
      live
    >
      {copy.detail}
    </Notice>
  );
}

/* ---------------------------------------------------------------- furniture */

function Notice({
  tone,
  icon,
  title,
  children,
  action,
  live,
}: {
  tone: "good" | "bad" | "muted";
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  live?: boolean;
}) {
  const ring = tone === "good" ? TONE_PANEL.good : tone === "bad" ? TONE_PANEL.bad : TONE_PANEL.neutral;
  const badge = tone === "good" ? TONE_BADGE.good : tone === "bad" ? TONE_BADGE.bad : TONE_BADGE.neutral;
  return (
    <div
      {...(live ? { role: "status", "aria-live": "polite" as const } : {})}
      className={cx("flex flex-col items-center gap-3 rounded-lg border p-6 text-center sm:p-8", ring)}
    >
      <span className={cx("flex size-12 items-center justify-center rounded-full", badge)}>{icon}</span>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="text-sm text-[#637075]">{children}</p>
      {action}
    </div>
  );
}

function PanelSkeleton() {
  const bar = "animate-pulse rounded-lg bg-[#f3f4f5]";
  return (
    <div role="status" aria-label="Loading payment options" className="space-y-4">
      <div className={cx(bar, "h-44")} />
      <div className={cx(bar, "h-11 rounded-lg")} />
    </div>
  );
}
