"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Building2, CheckCircle2, Clock, CreditCard, Loader2, Lock, X } from "lucide-react";
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
}

type Step =
  | { kind: "form" }
  | { kind: "starting" }
  | { kind: "pay"; session: PortalPaymentSession }
  | { kind: "polling"; paymentId: string; amount: number }
  | { kind: "done"; outcome: PaymentOutcome; amount: number };

/* --------------------------------------------------------------------- shell */

const label = "text-sm font-medium";
const hint = "text-xs text-muted-foreground";

/** Full-screen, like the document viewer: a phone has no room for a modal-in-a-modal. */
export function PaymentPanel(props: PaymentPanelProps) {
  const { doc, onClose } = props;
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

  // Coming back from a redirect there is nothing left to choose — the page is a receipt.
  const title = props.resumePaymentId ? "Your payment" : `Pay invoice #${doc.number}`;
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
          <span className={cx(hint, "inline-flex flex-none items-center gap-1")}>
            <Lock className="size-3.5" aria-hidden /> Secure
          </span>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-lg space-y-4 p-4 sm:p-6">
          <PanelBody {...props} />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- the states */

function PanelBody({ doc, loaders, onClose, onPaid, businessName, returnUrl, resumePaymentId }: PaymentPanelProps) {
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
      <Notice tone="good" icon={<CheckCircle2 className="size-6" aria-hidden />} title="This invoice is settled">
        Thank you — there&apos;s nothing left to pay on invoice #{opts.number}.
        {opts.amountPending > 0 ? ` A bank payment of ${formatMoney(opts.amountPending)} is still clearing.` : ""}
      </Notice>
    );
  }
  if (!payableOnline(opts)) {
    return (
      <Notice tone="muted" icon={<Building2 className="size-6" aria-hidden />} title="Online payment isn't available here">
        {formatMoney(opts.amountDue)} is owed on invoice #{opts.number}, but{" "}
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
}: {
  doc: PortalDocumentSummary;
  options: PortalPaymentOptions;
  step: Step;
  setStep: (s: Step) => void;
  loaders: PaymentLoaders;
  returnUrl: (paymentId: string) => string;
  onDone: (outcome: PaymentOutcome, amount: number) => void;
  businessName?: string;
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
      <section className="space-y-4 rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
        <div className="space-y-1.5">
          <label htmlFor="pay-amount" className={label}>
            Amount to pay
          </label>
          <div
            className={cx(
              "flex items-center gap-1 rounded-xl border bg-background px-3 py-2.5 transition-colors focus-within:ring-2 focus-within:ring-ring",
              showError && "border-destructive",
              onPayStep && "opacity-60",
            )}
          >
            <span aria-hidden className="font-mono text-xl text-muted-foreground">
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
              onChange={(e) => {
                setRaw(e.target.value);
                setTouched(true);
              }}
              onBlur={() => {
                setTouched(true);
                if (amount !== null) setRaw(amount.toFixed(2));
              }}
              className="w-full min-w-0 bg-transparent font-mono text-xl font-semibold tabular-nums outline-none"
            />
          </div>
          <p id="pay-amount-help" className={showError ? "text-xs text-destructive" : hint} role={showError ? "alert" : undefined}>
            {showError
              ? error
              : options.allowPartial
                ? `You can pay any part of the ${formatMoney(options.amountDue)} balance.`
                : `This invoice is paid in one go — the full balance of ${formatMoney(options.amountDue)}.`}
          </p>
          {options.amountPending > 0 ? (
            <p className={hint}>
              {formatMoney(options.amountPending)} is already on its way from your bank and isn&apos;t counted here.
            </p>
          ) : null}
        </div>

        {choices.length > 1 ? (
          <fieldset disabled={onPayStep} className="space-y-1.5">
            <legend className={cx(label, "mb-1.5")}>How would you like to pay?</legend>
            <div role="radiogroup" aria-label="How would you like to pay?" className="space-y-2">
              {choices.map((choice) => (
                <label
                  key={choice.value}
                  className={cx(
                    "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors has-checked:border-brand has-checked:bg-brand/5",
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
                    className="mt-1 size-4 flex-none accent-[var(--brand)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  />
                  <span className="min-w-0 space-y-0.5">
                    <span className="block text-sm font-medium">{choice.label}</span>
                    <span className="block text-xs text-muted-foreground">{choice.description}</span>
                    {choice.reason ? <span className={`block text-xs ${TONE_TEXT.warning}`}>{choice.reason}</span> : null}
                  </span>
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
        <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
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
          {step.kind === "starting" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CreditCard className="size-4" aria-hidden />}
          Continue to payment
        </button>
      )}

      <p className={cx(hint, "text-center")}>
        Payments are handled by Stripe. {businessName ?? "We"} never sees your card details.
      </p>
    </>
  );
}

function Summary({ amount, fee, total, feeLabel }: { amount: number; fee: number; total: number; feeLabel: string }) {
  return (
    <div role="group" aria-label="Payment summary" className="space-y-1.5 rounded-xl bg-muted/60 p-3 text-sm">
      <Row label="Amount" value={amount} />
      {fee > 0 ? <Row label={feeLabel} value={fee} /> : null}
      <div className="border-t pt-1.5">
        <Row label="Total" value={total} strong />
      </div>
    </div>
  );
}

function Row({ label: text, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={strong ? "font-semibold" : "text-muted-foreground"}>{text}</span>
      <span className={cx("font-mono tabular-nums", strong && "text-base font-semibold")}>{formatMoney(value)}</span>
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
          className="space-y-1 rounded-xl border border-destructive/40 bg-destructive/5 p-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <p className="text-sm font-semibold text-destructive">{declined.title}</p>
          <p className="text-sm text-destructive/90">{declined.detail}</p>
        </div>
      ) : null}

      {/* A fixed floor, so the card fields dropping in never shove the button. */}
      <div className="min-h-[248px] rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
        {failed ? (
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load the secure card form. Please refresh the page and try again, or pay by another means.
          </p>
        ) : (
          <>
            {checkout.type === "loading" ? (
              <div role="status" aria-label="Loading the secure card form" className="space-y-3">
                <div className="h-10 animate-pulse rounded-lg bg-muted" />
                <div className="h-10 animate-pulse rounded-lg bg-muted" />
                <div className="h-10 w-2/3 animate-pulse rounded-lg bg-muted" />
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
    <div role="status" className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-8 text-center shadow-xs">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
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
      className={cx("flex flex-col items-center gap-3 rounded-2xl border p-6 text-center shadow-xs sm:p-8", ring)}
    >
      <span className={cx("flex size-12 items-center justify-center rounded-xl", badge)}>{icon}</span>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{children}</p>
      {action}
    </div>
  );
}

function PanelSkeleton() {
  const bar = "animate-pulse rounded-lg bg-muted";
  return (
    <div role="status" aria-label="Loading payment options" className="space-y-4">
      <div className={cx(bar, "h-44 rounded-2xl")} />
      <div className={cx(bar, "h-11 rounded-lg")} />
    </div>
  );
}
