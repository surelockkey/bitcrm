"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { DialogFooter } from "@/components/ui/dialog";
import { WzButton } from "@/components/workiz/button";
import { WzTextField } from "@/components/workiz/text-field";
import { formatMoney } from "@/features/billing/lib";
import { useContact } from "@/features/clients/hooks";
import { contactName, primaryEmail } from "@/features/clients/lib";
import { getApiErrorMessage } from "@/lib/api/errors";
import { LIGHT } from "@/lib/theme/tokens";
import { cn } from "@/lib/utils";
import * as api from "../api";
import { runCardCharge } from "../card-charge";
import { useInvalidateLedger } from "../hooks";
import { PAYMENT_BOX, PAYMENT_BUTTON, PAYMENT_FOOTER } from "./payment-boxes";

/*
 * Add payment → Credit charge (Workiz): Name on card, Card number, MM/YY · CVV,
 * Zip code (half a row), Client's email address (optional), then AMOUNT /
 * SERVICE FEE (x%) / TOTAL and Close · Charge. The card fields are Stripe Elements — the number never
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

/**
 * Inside Stripe's frames, as Workiz's own card boxes: 16px #666, the words
 * ("Card number", "MM/YY", "CVV") in the kit labels' #8c8c8c, a plain sans.
 * A frame cannot read our CSS variables, so the theme's values go in as is.
 */
const ELEMENT_STYLE: StripeElementStyle = {
  base: {
    fontSize: "16px",
    color: LIGHT.wzText,
    fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    "::placeholder": { color: LIGHT.wzLabel },
  },
  invalid: { color: LIGHT.wzError },
};

/**
 * A Stripe frame in the kit's 48px box (`WzTextField`'s look): 1px #ccc, 4px
 * corners, the yellow edge while the frame has focus. The frame cannot be
 * labelled from outside, so its box is the named group.
 */
function StripeBox({ label, children }: { label: string; children: (focus: FocusHandlers) => ReactNode }) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="min-h-[3.04rem] min-w-0">
      <div
        role="group"
        aria-label={label}
        data-focused={focused ? "true" : "false"}
        className={cn(
          PAYMENT_BOX,
          "flex h-12 w-full items-center border border-input bg-white px-2.5 transition-[border-color] duration-300 data-[focused=true]:border-wz-focus",
        )}
      >
        {children({ onFocus: () => setFocused(true), onBlur: () => setFocused(false) })}
      </div>
    </div>
  );
}

interface FocusHandlers {
  onFocus: () => void;
  onBlur: () => void;
}

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

  const box = { overhang: false, inputClassName: PAYMENT_BOX } as const;

  return (
    <div className="flex flex-col gap-2.5">
      <WzTextField
        {...box}
        label="Name on card"
        autoComplete="cc-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
      />

      <StripeBox label="Card number">
        {(focus) => (
          <CardNumberElement
            {...focus}
            className="w-full"
            options={{ style: ELEMENT_STYLE, placeholder: "Card number", showIcon: false, disableLink: true }}
          />
        )}
      </StripeBox>

      <div data-slot="card-row" className="grid grid-cols-2 gap-x-4">
        <StripeBox label="MM/YY">
          {(focus) => <CardExpiryElement {...focus} className="w-full" options={{ style: ELEMENT_STYLE, placeholder: "MM/YY" }} />}
        </StripeBox>
        <StripeBox label="CVV">
          {(focus) => <CardCvcElement {...focus} className="w-full" options={{ style: ELEMENT_STYLE, placeholder: "CVV" }} />}
        </StripeBox>
      </div>

      {/* Workiz: the ZIP alone on its row, as wide as MM/YY. */}
      <div data-slot="card-row" className="grid grid-cols-2 gap-x-4">
        <WzTextField
          {...box}
          label="Zip code"
          autoComplete="postal-code"
          inputMode="numeric"
          maxLength={10}
          value={zip}
          onChange={(e) => setZip(e.target.value)}
          error={errors.zip}
        />
      </div>

      <WzTextField
        {...box}
        label="Client's email address (optional)"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.email}
      />

      {/* AMOUNT / SERVICE FEE / TOTAL: 14px ink rows 24px apart, 8px in, a
          rule over the bold TOTAL. */}
      <dl data-testid="charge-breakdown" className="mt-2 text-sm leading-6 text-foreground">
        <div className="flex justify-between px-2">
          <dt>AMOUNT</dt>
          <dd className="tabular-nums">{formatMoney(amount)}</dd>
        </div>
        {surchargePercent > 0 ? (
          <div className="flex justify-between px-2">
            <dt>{`${surchargeLabel.toUpperCase()} (${surchargePercent}%)`}</dt>
            <dd className="tabular-nums">{formatMoney(fee)}</dd>
          </div>
        ) : null}
        <div className="mt-1.5 flex justify-between border-t border-[#eeeeee] px-2 pt-[3px] font-semibold">
          <dt>TOTAL</dt>
          <dd className="tabular-nums">{formatMoney(total)}</dd>
        </div>
      </dl>

      {failure ? (
        <p role="alert" className="text-sm text-wz-error">
          {failure}
        </p>
      ) : null}

      <DialogFooter className={PAYMENT_FOOTER}>
        <WzButton variant="secondary" size="regular" className={PAYMENT_BUTTON} onClick={onClose} disabled={busy}>
          Close
        </WzButton>
        <WzButton variant="primary" size="regular" className={PAYMENT_BUTTON} onClick={charge} loading={busy}>
          Charge
        </WzButton>
      </DialogFooter>
    </div>
  );
}
