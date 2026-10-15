import type { Stripe, StripeCardNumberElement } from "@stripe/stripe-js";
import type { KeyedPaymentIntent, TerminalIntentOutcome } from "@bitcrm/types";
import type { CardIntentBody } from "./api";

/**
 * Add payment → Credit charge, end to end, with every collaborator handed in
 * (Stripe.js, the card field, billing's three routes) so it can be tested
 * without a browser:
 *
 *  1. Stripe.js turns the typed card into a PaymentMethod IN THE BROWSER —
 *     the name on card, ZIP and the client's email ride on it as
 *     `billing_details`. Billing only ever sees the `pm_…`.
 *  2. `POST /deals/:dealId/card-intent` writes the pending row, then creates
 *     and confirms the PaymentIntent (fee included) under `attemptId`.
 *  3. `requires_action` (3-D Secure): `stripe.handleNextAction`, then
 *     `…/sync` asserts what Stripe says. A step the client gave up on is
 *     cancelled, so nothing chargeable is left behind.
 *
 * A billing error (network, 4xx/5xx) is thrown as is: the caller shows it
 * and may retry under the SAME attempt id.
 */

export interface CardChargeDeps {
  stripe: Pick<Stripe, "createPaymentMethod" | "handleNextAction">;
  card: StripeCardNumberElement;
  charge: (body: CardIntentBody) => Promise<KeyedPaymentIntent>;
  sync: (paymentId: string) => Promise<TerminalIntentOutcome>;
  cancel: (paymentId: string) => Promise<unknown>;
}

export interface CardChargeInput {
  amount: number;
  attemptId: string;
  billing: { name: string; zip: string; email?: string };
}

export type CardChargeResult =
  | { kind: "charged"; paymentId: string; amount: number; total: number }
  | { kind: "processing"; paymentId: string; amount: number; total: number }
  | { kind: "declined"; paymentId: string; message: string }
  /** Stripe.js refused the card details before anything was sent (incomplete number…). */
  | { kind: "error"; message: string };

const NOT_CHARGED = "The card was not charged";

export async function runCardCharge(deps: CardChargeDeps, input: CardChargeInput): Promise<CardChargeResult> {
  const email = input.billing.email?.trim();
  const { paymentMethod, error } = await deps.stripe.createPaymentMethod({
    type: "card",
    card: deps.card,
    billing_details: {
      name: input.billing.name.trim(),
      ...(email ? { email } : {}),
      address: { postal_code: input.billing.zip.trim() },
    },
  });
  if (error || !paymentMethod) return { kind: "error", message: error?.message || "Check the card details" };

  const intent = await deps.charge({ amount: input.amount, attemptId: input.attemptId, paymentMethodId: paymentMethod.id });
  const money = { paymentId: intent.paymentId, amount: intent.amount, total: intent.total };

  switch (intent.status) {
    case "succeeded":
      return { kind: "charged", ...money };
    case "processing":
      return { kind: "processing", ...money };
    case "requires_action": {
      const step = await deps.stripe.handleNextAction({ clientSecret: intent.clientSecret });
      const { payment } = await deps.sync(intent.paymentId);
      if (payment.status === "settled") return { kind: "charged", ...money };
      if (payment.status === "failed") {
        return { kind: "declined", paymentId: intent.paymentId, message: payment.failureReason || step.error?.message || NOT_CHARGED };
      }
      if (step.error) {
        await deps.cancel(intent.paymentId).catch(() => undefined);
        return { kind: "declined", paymentId: intent.paymentId, message: step.error.message || NOT_CHARGED };
      }
      return { kind: "processing", ...money };
    }
    default:
      return { kind: "declined", paymentId: intent.paymentId, message: intent.declineMessage || NOT_CHARGED };
  }
}
