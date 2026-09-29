import type {
  OnlinePaymentMethod,
  PaymentMethod,
  PaymentStatus,
  PortalPaymentOptions,
} from "@bitcrm/types";
import { PublicApiError, formatMoney, isInvalidPortalError } from "./lib";

/* --------------------------------------------------------------------- money */

/** Dollars to the cent, once. (`Number.EPSILON` so 1.005 is not 1.00.) */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** A cent of slack, so a balance carrying float drift still counts as "the full balance". */
const CENT = 0.005;

/**
 * What the customer typed, as a number — or `null`. Dollar signs, thousands
 * separators and stray spaces are theirs to type and ours to ignore; anything
 * else (a minus sign, two dots, letters) is a typo we refuse rather than guess.
 */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (cleaned === "" || cleaned === "." || !/^\d*\.?\d*$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export interface AmountCheck {
  /** The amount to charge, cent-rounded — `null` while the field is not yet valid. */
  amount: number | null;
  /** Customer-facing reason, `null` when the amount is good. */
  error: string | null;
}

/**
 * The client half of `0 < x <= amountDue`. The server clamps too — this exists
 * so the customer is told before they commit, not after.
 */
export function checkAmount(
  raw: string,
  options: Pick<PortalPaymentOptions, "amountDue" | "allowPartial">,
): AmountCheck {
  const due = round2(options.amountDue);
  const parsed = parseAmount(raw);
  if (parsed === null) return { amount: null, error: "Enter an amount to pay." };

  const amount = round2(parsed);
  if (amount <= 0) return { amount: null, error: "Enter an amount greater than $0.00." };
  if (amount > due + CENT) {
    return { amount: null, error: `That's more than the ${formatMoney(due)} balance. Enter ${formatMoney(due)} or less.` };
  }
  if (!options.allowPartial && amount < due - CENT) {
    return { amount: null, error: `This invoice is paid in one go — please enter the full balance of ${formatMoney(due)}.` };
  }
  return { amount: Math.min(amount, due), error: null };
}

export interface PaymentTotals {
  amount: number;
  /** The card surcharge. 0 unless the business has turned surcharging on. */
  fee: number;
  total: number;
}

/** US card-network ceiling; mirrors `MAX_SURCHARGE_PERCENT` in the shared types. */
const MAX_PERCENT = 3;

export function computeTotals(amount: number, surchargePercent: number): PaymentTotals {
  const pct = Math.min(Math.max(surchargePercent || 0, 0), MAX_PERCENT);
  const base = round2(amount);
  const fee = pct > 0 ? round2((base * pct) / 100) : 0;
  return { amount: base, fee, total: round2(base + fee) };
}

/* ------------------------------------------------------------------- methods */

export interface MethodChoice {
  value: OnlinePaymentMethod;
  label: string;
  description: string;
  disabled: boolean;
  /** Why it is disabled, in words the customer can act on. */
  reason?: string;
}

/**
 * The methods this invoice offers, in the order a customer expects, each
 * already knowing whether the amount on screen qualifies for it.
 */
export function methodChoices(
  options: Pick<PortalPaymentOptions, "methods" | "bankMinimum">,
  amount: number | null,
): MethodChoice[] {
  const min = Math.max(options.bankMinimum || 0, 0);
  const belowMin = amount !== null && amount < min - CENT;
  const all: MethodChoice[] = [
    { value: "card", label: "Card", description: "Visa, Mastercard, Amex, Apple Pay or Google Pay", disabled: false },
    {
      value: "bank",
      label: "Bank account",
      description: "Paid straight from your bank — takes 2–4 business days to clear",
      disabled: belowMin,
      reason: belowMin ? `Bank payments start at ${formatMoney(min)}. Pay by card, or raise the amount.` : undefined,
    },
  ];
  return all.filter((c) => options.methods.includes(c.value));
}

/** Is there anything to pay, and a way to pay it? */
export function payableOnline(options: Pick<PortalPaymentOptions, "amountDue" | "methods">): boolean {
  return options.amountDue > 0 && options.methods.length > 0;
}

/**
 * The first method a customer should land on: card when offered and usable,
 * otherwise the first one that is not disabled, otherwise the first at all.
 */
export function defaultMethod(choices: MethodChoice[]): OnlinePaymentMethod | null {
  return (choices.find((c) => c.value === "card" && !c.disabled) ?? choices.find((c) => !c.disabled) ?? choices[0])?.value ?? null;
}

/* ---------------------------------------------------------------- the ledger */

/** `GET /billing/public/portal/:token/payment/:paymentId` — the poll after a payment. */
export interface PortalPaymentStatus {
  status: PaymentStatus;
  amount: number;
  method: PaymentMethod;
  receiptSent: boolean;
}

/** How a payment ended, as far as the customer is concerned. */
export type PaymentOutcome = "settled" | "pending" | "failed" | "unknown";

/** Ten tries, two seconds apart: about twenty seconds for the webhook to land. */
export const MAX_STATUS_POLLS = 10;
export const STATUS_POLL_MS = 2000;

export function outcomeOfStatus(status: PaymentStatus): PaymentOutcome {
  if (status === "settled" || status === "refunded") return "settled";
  if (status === "pending") return "pending";
  if (status === "failed" || status === "reversed") return "failed";
  return "unknown";
}

/* ------------------------------------------------------------------ the copy */

export interface Copy {
  title: string;
  detail: string;
}

/** A failed confirm, in the customer's language — with Stripe's own reason kept. */
/**
 * Why starting a payment failed, in words the customer can act on.
 *
 * 409 is its own case and must not read as "try again": the server refuses a
 * new session when an earlier payment is still clearing and covers the
 * balance, so retrying changes nothing and paying again would double-charge.
 */
export function startErrorCopy(e: unknown): string {
  if (isInvalidPortalError(e)) {
    return "This invoice can't be paid right now. Please reopen your link, or contact us for a new one.";
  }
  if (e instanceof PublicApiError && e.status === 409) {
    return "There's nothing left to pay right now — an earlier payment is still clearing. We'll email you when it lands.";
  }
  return "We couldn't start the payment. Check your connection and try again — nothing has been charged.";
}

export function confirmErrorCopy(message: string | undefined): Copy {
  const reason = message?.trim();
  return {
    title: "That payment didn't go through",
    detail: reason
      ? `${reason.replace(/\s+$/, "")} Check the details or try another card — nothing has been charged.`
      : "Your bank turned the payment down. Check the details or try another card — nothing has been charged.",
  };
}

export function outcomeCopy(outcome: PaymentOutcome, amount: number): Copy {
  const money = formatMoney(amount);
  switch (outcome) {
    case "settled":
      return { title: "Payment received", detail: `Thank you — your ${money} payment went through. A receipt is on its way to your email.` };
    case "pending":
      return {
        title: "Your bank payment is on its way",
        detail: `We've started the transfer of ${money}. Bank payments take 2–4 business days; we'll email you when it clears.`,
      };
    case "failed":
      return {
        title: "That payment didn't go through",
        detail: "Your bank turned it down and nothing has been charged. You can try again with another card or bank account.",
      };
    default:
      return {
        title: "Payment submitted",
        detail: `We've sent your ${money} payment to the bank and are waiting on confirmation. We'll email you a receipt as soon as it lands — no need to pay again.`,
      };
  }
}
