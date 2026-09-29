import {
  Banknote,
  CreditCard,
  Landmark,
  ReceiptText,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  MAX_SURCHARGE_PERCENT,
  type DocumentTotals,
  type OnlinePaymentMethod,
  type Payment,
  type PaymentMethod,
  type PaymentSettings,
  type PaymentStatus,
} from "@bitcrm/types";
import { formatMoney } from "@/features/billing/lib";
import { isYmd, todayYmd } from "@/features/billing/dates";

/* --------------------------------------------------------------- money */

const toCents = (dollars: number): number => Math.round((dollars + Number.EPSILON) * 100);
const toDollars = (cents: number): number => Math.round(cents) / 100;
const safe = (n: number | undefined | null): number =>
  typeof n === "number" && Number.isFinite(n) ? n : 0;

/* -------------------------------------------------------------- labels */

/**
 * Status tones mirror the invoice badge: amber while the money is in flight,
 * emerald once it has landed, red when it never did or came back.
 */
export const PAYMENT_STATUS_META: Record<PaymentStatus, { label: string; className: string }> = {
  pending: {
    label: "Clearing",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  settled: {
    label: "Paid",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  failed: {
    label: "Failed",
    className: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
  },
  reversed: {
    label: "Reversed",
    className: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
  },
  refunded: {
    label: "Refunded",
    className: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  },
};

export function paymentStatusLabel(status: PaymentStatus): string {
  return PAYMENT_STATUS_META[status]?.label ?? status;
}

export const PAYMENT_METHOD_META: Record<PaymentMethod, { label: string; icon: LucideIcon }> = {
  card: { label: "Card", icon: CreditCard },
  bank: { label: "Bank", icon: Landmark },
  cash: { label: "Cash", icon: Banknote },
  check: { label: "Check", icon: ReceiptText },
  other: { label: "Other", icon: Wallet },
};

export function paymentMethodLabel(method: PaymentMethod): string {
  return PAYMENT_METHOD_META[method]?.label ?? method;
}

/** What staff can key in by hand. `bank` is online-only (ACH runs through Stripe). */
export const OFFLINE_PAYMENT_METHODS = ["cash", "check", "card", "other"] as const;
export type OfflinePaymentMethod = (typeof OFFLINE_PAYMENT_METHODS)[number];

/** The record-payment picker says where the card was swiped — the row doesn't. */
export const OFFLINE_METHOD_LABEL: Record<OfflinePaymentMethod, string> = {
  cash: "Cash",
  check: "Check",
  card: "Card (taken in person)",
  other: "Other",
};

/** Bank money is taken now and lands later; the row says so out loud. */
export const CLEARING_NOTE = "Bank payments take 2–4 business days to clear.";

/** A validated money string → dollars, rounded to cents. */
export function parseMoney(raw: string): number {
  return toDollars(toCents(Number(raw)));
}

/* -------------------------------------------------------------- refunds */

/** Dollars still refundable on a payment — the gross less what already went back. */
export function remainingRefundable(
  payment: Pick<Payment, "amount" | "refundedAmount" | "status">,
): number {
  // Only settled money can come back: a partial refund leaves the payment
  // `settled`, a full one flips it to `refunded` with nothing left.
  if (payment.status !== "settled") return 0;
  return toDollars(Math.max(0, toCents(safe(payment.amount)) - toCents(safe(payment.refundedAmount))));
}

export function canRefund(
  payment: Pick<Payment, "amount" | "refundedAmount" | "status">,
): boolean {
  return remainingRefundable(payment) > 0;
}

export function overRefundMessage(remaining: number): string {
  return `You can refund at most ${formatMoney(remaining)} on this payment.`;
}

/**
 * Client-side guard for the refund dialog. The server clamps too — this only
 * keeps the staff member from firing a request that cannot succeed.
 */
export function refundAmountError(
  payment: Pick<Payment, "amount" | "refundedAmount" | "status">,
  raw: string,
): string | null {
  const remaining = remainingRefundable(payment);
  if (remaining <= 0) return "This payment can't be refunded";
  const n = raw.trim() === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(n)) return "Enter an amount to refund";
  if (n <= 0) return `Enter an amount greater than ${formatMoney(0)}`;
  if (toCents(n) > toCents(remaining)) return overRefundMessage(remaining);
  return null;
}

/* ------------------------------------------------------------- balances */

/**
 * Workiz shows a part-paid invoice as still due — the status never becomes
 * "partial", a badge next to it says so.
 */
export function isPartiallyPaid(settled: number, balanceDue: number): boolean {
  return safe(settled) > 0 && safe(balanceDue) > 0;
}

/**
 * Restate a document's Paid / Balance due from the ledger. The totals a job
 * snapshot carries can lag a payment by a beat; the ledger is the truth.
 */
export function applyAmountPaid(totals: DocumentTotals, amountPaid: number): DocumentTotals {
  const totalCents = toCents(totals.total);
  const paidCents = Math.min(Math.max(0, toCents(amountPaid)), totalCents);
  return { ...totals, amountPaid: toDollars(paidCents), balanceDue: toDollars(totalCents - paidCents) };
}

/* ------------------------------------------------------- online methods */

/**
 * What the account can offer a client online right now. Empty when online
 * payments are off — then an invoice goes out with no Pay button at all.
 */
export function availableOnlineMethods(
  settings: Pick<PaymentSettings, "onlinePaymentsEnabled" | "cardEnabled" | "bankEnabled"> | undefined,
): OnlinePaymentMethod[] {
  if (!settings?.onlinePaymentsEnabled) return [];
  const out: OnlinePaymentMethod[] = [];
  if (settings.cardEnabled) out.push("card");
  if (settings.bankEnabled) out.push("bank");
  return out;
}

/** Order-insensitive comparison — the checkbox pair can produce either order. */
export function sameMethods(
  a: OnlinePaymentMethod[] | undefined | null,
  b: OnlinePaymentMethod[] | undefined | null,
): boolean {
  if (!a || !b) return !a === !b;
  return a.length === b.length && a.every((m) => b.includes(m));
}

/* ---------------------------------------------------------------- dates */

/**
 * When a payment was taken, as an instant. Today keeps the clock time; a
 * back-dated day is pinned to local midday so no timezone pushes it to the
 * day before.
 */
export function takenAtIso(day: string, now: Date = new Date()): string {
  if (!isYmd(day) || day === todayYmd(now)) return now.toISOString();
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}

/* ------------------------------------------------------------ list/query */

export interface PaymentListParams {
  from?: string;
  to?: string;
  method?: PaymentMethod;
  status?: PaymentStatus;
  contactId?: string;
  dealId?: string;
  limit?: number;
  cursor?: string;
}

export function buildPaymentListQuery(p: PaymentListParams): string {
  const q = new URLSearchParams();
  if (p.from) q.set("from", p.from);
  if (p.to) q.set("to", p.to);
  if (p.method) q.set("method", p.method);
  if (p.status) q.set("status", p.status);
  if (p.contactId) q.set("contactId", p.contactId);
  if (p.dealId) q.set("dealId", p.dealId);
  if (p.limit) q.set("limit", String(p.limit));
  if (p.cursor) q.set("cursor", p.cursor);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export type PaymentMethodFilter = "all" | PaymentMethod;
export type PaymentStatusFilter = "all" | PaymentStatus;

/* ------------------------------------------------------------- settings */

/**
 * Shown beside the surcharge field. It ships at 0 on purpose — see the
 * payments contract: the card networks cap a surcharge at the lower of your
 * processing rate or 3% (credit cards only), several states ban it outright,
 * and steering the client to a bank payment saves more with none of that.
 */
export const SURCHARGE_WARNING =
  `Off by default, and worth leaving off. US card-network rules cap a surcharge at the lower of ` +
  `your processing rate or ${MAX_SURCHARGE_PERCENT}% and allow it on credit cards only. It is banned ` +
  `outright in Connecticut, Massachusetts, Maine and Puerto Rico, capped at 2% in Colorado, and New ` +
  `York forbids revealing it after the client has picked a card. Offering bank payment saves you more ` +
  `than a surcharge collects, with none of the compliance risk.`;
