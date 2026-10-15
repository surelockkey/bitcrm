"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Stripe, StripeCardNumberElement, StripeElementStyle } from "@stripe/stripe-js";
import { loadStripe } from "@stripe/stripe-js/pure";
import {
  CardCvcElement,
  CardExpiryElement,
  CardNumberElement,
  Elements,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cardServiceFee } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/features/billing/lib";
import { useContact } from "@/features/clients/hooks";
import { contactName, primaryEmail } from "@/features/clients/lib";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "../api";
import { runCardCharge } from "../card-charge";
import { useInvalidateLedger } from "../hooks";

/*
 * Add payment → Credit charge (Workiz): Name on card, Card number, MM/YY, CVV,
 * Zip code, Client's email (optional), then AMOUNT / SERVICE FEE (x%) / TOTAL
 * and Close · Charge. The card fields are Stripe Elements — the number never
 * touches our page or our API; billing only receives the `pm_…`.
 *
 * This module is loaded on demand (React.lazy) the first time Credit charge is
 * picked, and `@stripe/stripe-js/pure` requests js.stripe.com only when
 * `loadStripe` runs — so the office never loads Stripe for a cash payment.
 */

const stripeByKey = new Map<string, Promise<Stripe | null>>();

function getStripe(publishableKey: string): Promise<Stripe | null> {
  let promise = stripeByKey.get(publishableKey);
  if (!promise) {
    promise = loadStripe(publishableKey);
    // A failed load (offline, blocked) may be retried next time.
    promise.catch(() => stripeByKey.delete(publishableKey));
    stripeByKey.set(publishableKey, promise);
  }
  return promise;
}

const ELEMENT_STYLE: StripeElementStyle = {
  base: { fontSize: "14px", color: "#0f172a", "::placeholder": { color: "#94a3b8" } },
  invalid: { color: "#dc2626" },
};

/** Looks like our `Input`, holds a Stripe iframe. */
const FIELD = "border-input flex h-9 w-full items-center rounded-md border bg-transparent px-3 shadow-xs";

export interface CardChargeFormProps {
  invoiceId: string;
  dealId: string;
  contactId?: string;
  publishableKey: string;
  surchargePercent: number;
  surchargeLabel: string;
  /** The amount box as it reads now (0 while it is not a number). */
  amount: number;
  /** Validates the amount box and answers it in dollars — or null, with its error shown. */
  resolveAmount: () => Promise<number | null>;
  onDone: () => void;
  onClose: () => void;
}

export default function CardChargeForm(props: CardChargeFormProps) {
  const contact = useContact(props.contactId ?? "");
  // Name on card starts as the client's name: wait for the client before drawing the form.
  if (props.contactId && contact.isLoading) {
    return (
      <div className="flex justify-center py-6" aria-busy="true">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return (
    <Elements stripe={getStripe(props.publishableKey)}>
      <ChargeFields
        {...props}
        clientName={contact.data ? contactName(contact.data) : ""}
        clientEmail={contact.data?.emails ? (primaryEmail(contact.data) ?? "") : ""}
      />
    </Elements>
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ChargeFields({
  invoiceId,
  dealId,
  surchargePercent,
  surchargeLabel,
  amount,
  resolveAmount,
  onDone,
  onClose,
  clientName,
  clientEmail,
}: CardChargeFormProps & { clientName: string; clientEmail: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const invalidate = useInvalidateLedger(invoiceId, dealId);
  const ids = useId();
  const [name, setName] = useState(clientName);
  const [zip, setZip] = useState("");
  const [email, setEmail] = useState(clientEmail);
  const [errors, setErrors] = useState<{ name?: string; zip?: string; email?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The attempt in hand: re-sent as is after a billing error, renewed after any answer from Stripe. */
  const attempt = useRef<{ id: string; amount: number } | null>(null);
  /** An attempt waiting on 3-D Secure — cancelled if the dialog goes away meanwhile. */
  const awaitingAction = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (awaitingAction.current) void api.cancelCardAttempt(awaitingAction.current).catch(() => undefined);
    },
    [],
  );

  const fee = cardServiceFee(amount, 0, surchargePercent);
  const total = Math.round((amount + fee) * 100) / 100;

  const charge = async () => {
    setFailure(null);
    const nextErrors = {
      ...(!name.trim() && { name: "Enter the name on the card" }),
      ...(!zip.trim() && { zip: "Enter the card's ZIP code" }),
      ...(email.trim() && !EMAIL.test(email.trim()) && { email: "Enter a valid email or leave it empty" }),
    };
    setErrors(nextErrors);
    const dollars = await resolveAmount();
    if (dollars === null || Object.keys(nextErrors).length > 0) return;
    const card = elements?.getElement(CardNumberElement) as StripeCardNumberElement | null | undefined;
    if (!stripe || !card) {
      setFailure("The card form is still loading — try again in a moment");
      return;
    }
    if (!attempt.current || attempt.current.amount !== dollars) {
      attempt.current = { id: crypto.randomUUID(), amount: dollars };
    }

    setBusy(true);
    try {
      const result = await runCardCharge(
        {
          stripe,
          card,
          charge: async (body) => {
            const res = await api.chargeCardOnDeal(dealId, body);
            if (res.status === "requires_action") awaitingAction.current = res.paymentId;
            return res;
          },
          sync: api.syncCardAttempt,
          cancel: api.cancelCardAttempt,
        },
        { amount: dollars, attemptId: attempt.current.id, billing: { name, zip, email } },
      );
      awaitingAction.current = null;
      if (result.kind === "error") {
        setFailure(result.message);
        return;
      }
      // Stripe answered: whatever comes next is a new attempt.
      attempt.current = null;
      if (result.kind === "declined") {
        setFailure(result.message);
        invalidate();
        return;
      }
      invalidate();
      if (result.kind === "charged") toast.success(`Charged ${formatMoney(result.total)}`);
      else toast.message(`The ${formatMoney(result.total)} card payment is processing — it shows as clearing until it lands`);
      const to = email.trim();
      if (to) {
        void api
          .resendReceipt(result.paymentId, { channel: "email", to })
          .catch((e) => toast.error(getApiErrorMessage(e, "The receipt couldn't be emailed")));
      }
      onDone();
    } catch (e) {
      // Billing (or the network) failed: the same attempt id asks again safely.
      setFailure(getApiErrorMessage(e, "The card couldn't be charged"));
    } finally {
      setBusy(false);
    }
  };

  const id = (k: string) => `${ids}-${k}`;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={id("name")}>Name on card</Label>
        <Input
          id={id("name")}
          autoComplete="cc-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!errors.name}
        />
        {errors.name ? <p className="text-sm text-destructive">{errors.name}</p> : null}
      </div>

      <div className="space-y-1.5">
        <Label id={id("number")}>Card number</Label>
        <div className={FIELD} aria-labelledby={id("number")}>
          <CardNumberElement className="w-full" options={{ style: ELEMENT_STYLE, showIcon: true }} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label id={id("exp")}>MM/YY</Label>
          <div className={FIELD} aria-labelledby={id("exp")}>
            <CardExpiryElement className="w-full" options={{ style: ELEMENT_STYLE }} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label id={id("cvc")}>CVV</Label>
          <div className={FIELD} aria-labelledby={id("cvc")}>
            <CardCvcElement className="w-full" options={{ style: ELEMENT_STYLE }} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("zip")}>Zip code</Label>
          <Input
            id={id("zip")}
            autoComplete="postal-code"
            inputMode="numeric"
            maxLength={10}
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            aria-invalid={!!errors.zip}
          />
        </div>
      </div>
      {errors.zip ? <p className="text-sm text-destructive">{errors.zip}</p> : null}

      <div className="space-y-1.5">
        <Label htmlFor={id("email")}>Client&apos;s email (optional)</Label>
        <Input
          id={id("email")}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={!!errors.email}
        />
        {errors.email ? <p className="text-sm text-destructive">{errors.email}</p> : null}
      </div>

      <dl data-testid="charge-breakdown" className="space-y-1 border-t pt-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-xs font-semibold tracking-wide text-muted-foreground">AMOUNT</dt>
          <dd className="tabular-nums">{formatMoney(amount)}</dd>
        </div>
        {surchargePercent > 0 ? (
          <div className="flex justify-between">
            <dt className="text-xs font-semibold tracking-wide text-muted-foreground">
              {`${surchargeLabel.toUpperCase()} (${surchargePercent}%)`}
            </dt>
            <dd className="tabular-nums">{formatMoney(fee)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between font-semibold">
          <dt className="text-xs tracking-wide">TOTAL</dt>
          <dd className="tabular-nums">{formatMoney(total)}</dd>
        </div>
      </dl>

      {failure ? (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Close
        </Button>
        <Button type="button" variant="brand" onClick={charge} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : null} Charge
        </Button>
      </DialogFooter>
    </div>
  );
}
