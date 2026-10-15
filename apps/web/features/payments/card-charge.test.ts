import { describe, expect, it, vi } from "vitest";
import type { KeyedPaymentIntent, Payment, TerminalIntentOutcome } from "@bitcrm/types";
import { runCardCharge, type CardChargeDeps } from "./card-charge";

const ATTEMPT = "0b9c6d2e-4f1a-4c3b-9d8e-7a6b5c4d3e2f";

const intent = (over: Partial<KeyedPaymentIntent> = {}): KeyedPaymentIntent => ({
  paymentId: ATTEMPT,
  intentId: "pi_1",
  clientSecret: "pi_1_secret",
  status: "succeeded",
  amount: 100,
  tipAmount: 0,
  feeAmount: 3,
  total: 103,
  currency: "usd",
  ...over,
});

const outcome = (over: Partial<Payment> = {}): TerminalIntentOutcome =>
  ({ payment: { id: ATTEMPT, status: "settled", ...over }, ledger: {} }) as unknown as TerminalIntentOutcome;

function deps(over: Record<string, unknown> = {}) {
  const d = {
    stripe: {
      createPaymentMethod: vi.fn(async () => ({ paymentMethod: { id: "pm_1" } })),
      handleNextAction: vi.fn(async () => ({})),
    },
    card: { kind: "card-number-element" },
    charge: vi.fn(async () => intent()),
    sync: vi.fn(async () => outcome()),
    cancel: vi.fn(async () => outcome({ status: "failed" })),
    ...over,
  };
  return d;
}

const input = { amount: 100, attemptId: ATTEMPT, billing: { name: "Walter White", zip: "06103", email: "walter@example.com" } };

describe("runCardCharge — the web's Credit charge", () => {
  it("turns the card into a PaymentMethod in the browser — name, ZIP and email as billing details — and sends only its id", async () => {
    const d = deps();
    const res = await runCardCharge(d as unknown as CardChargeDeps, input);
    expect(d.stripe.createPaymentMethod).toHaveBeenCalledWith({
      type: "card",
      card: d.card,
      billing_details: { name: "Walter White", email: "walter@example.com", address: { postal_code: "06103" } },
    });
    expect(d.charge).toHaveBeenCalledWith({ amount: 100, attemptId: ATTEMPT, paymentMethodId: "pm_1" });
    expect(res).toEqual({ kind: "charged", paymentId: ATTEMPT, amount: 100, total: 103 });
  });

  it("leaves the email out when none was typed", async () => {
    const d = deps();
    await runCardCharge(d as unknown as CardChargeDeps, { ...input, billing: { name: "W", zip: "1", email: "" } });
    expect(d.stripe.createPaymentMethod).toHaveBeenCalledWith({
      type: "card",
      card: d.card,
      billing_details: { name: "W", address: { postal_code: "1" } },
    });
  });

  it("stops on Stripe's own complaint about the card, before billing hears of it", async () => {
    const d = deps();
    d.stripe.createPaymentMethod.mockResolvedValueOnce({ error: { message: "Your card number is incomplete." } } as never);
    expect(await runCardCharge(d as unknown as CardChargeDeps, input)).toEqual({ kind: "error", message: "Your card number is incomplete." });
    expect(d.charge).not.toHaveBeenCalled();
  });

  it("answers a decline with the bank's words", async () => {
    const d = deps({ charge: vi.fn(async () => intent({ status: "requires_payment_method", declineMessage: "Your card was declined." })) });
    expect(await runCardCharge(d as unknown as CardChargeDeps, input)).toEqual({ kind: "declined", paymentId: ATTEMPT, message: "Your card was declined." });
  });

  it("runs 3-D Secure, then asks billing to settle from Stripe", async () => {
    const d = deps({ charge: vi.fn(async () => intent({ status: "requires_action" })) });
    const res = await runCardCharge(d as unknown as CardChargeDeps, input);
    expect(d.stripe.handleNextAction).toHaveBeenCalledWith({ clientSecret: "pi_1_secret" });
    expect(d.sync).toHaveBeenCalledWith(ATTEMPT);
    expect(res).toEqual({ kind: "charged", paymentId: ATTEMPT, amount: 100, total: 103 });
  });

  it("a failed 3-D Secure step is a decline with Stripe's reason", async () => {
    const d = deps({
      charge: vi.fn(async () => intent({ status: "requires_action" })),
      sync: vi.fn(async () => outcome({ status: "failed", failureReason: "We are unable to authenticate your payment method." })),
    });
    expect(await runCardCharge(d as unknown as CardChargeDeps, input)).toEqual({
      kind: "declined",
      paymentId: ATTEMPT,
      message: "We are unable to authenticate your payment method.",
    });
  });

  it("a 3-D Secure step given up leaves nothing chargeable behind: the attempt is cancelled", async () => {
    const d = deps({
      charge: vi.fn(async () => intent({ status: "requires_action" })),
      sync: vi.fn(async () => outcome({ status: "pending" })),
    });
    d.stripe.handleNextAction.mockResolvedValueOnce({ error: { message: "Authentication was cancelled." } } as never);
    expect(await runCardCharge(d as unknown as CardChargeDeps, input)).toEqual({ kind: "declined", paymentId: ATTEMPT, message: "Authentication was cancelled." });
    expect(d.cancel).toHaveBeenCalledWith(ATTEMPT);
  });

  it("says when the money is still on its way", async () => {
    const d = deps({ charge: vi.fn(async () => intent({ status: "processing" })) });
    expect(await runCardCharge(d as unknown as CardChargeDeps, input)).toEqual({ kind: "processing", paymentId: ATTEMPT, amount: 100, total: 103 });
  });
});
