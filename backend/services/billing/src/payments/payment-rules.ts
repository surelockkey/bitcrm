import {
  COUNTED_PAYMENT_STATUSES,
  EMPTY_PAYMENT_SUMMARY,
  type OnlinePaymentMethod,
  type Payment,
  type PaymentStatus,
  type PaymentSummary,
} from '@bitcrm/types';

/**
 * Pure payment arithmetic and state rules. No I/O, no Stripe, no Nest — the
 * service and the webhook handlers both reduce to these.
 *
 * Two ideas carry the whole ledger:
 *   1. What the customer has paid is a SUM over the ledger, never a flag:
 *      the gross of every payment in `COUNTED_PAYMENT_STATUSES` minus what
 *      has been given back. `pending` (ACH in transit) never counts, so a
 *      reversal simply lowers the sum and the invoice re-derives itself.
 *   2. Webhooks arrive out of order, so a handler ASSERTS a state rather
 *      than applying a delta: `canTransition` is the only way a payment's
 *      status ever moves, and `reversed` is a one-way door.
 */

/** Cents are the unit money is actually exact in; our types carry dollars. */
export const toCents = (dollars: number): number => Math.round(Number((dollars * 100).toFixed(2)));
export const fromCents = (cents: number): number => Math.round(cents) / 100;
/** Dollars, snapped to the nearest cent — the only rounding in the ledger. */
export const round2 = (n: number): number => toCents(n) / 100;

const isMoney = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Card surcharge (off by default — see PaymentSettings). Never enters DocumentTotals. */
export function surchargeFor(amount: number, percent: number): number {
  if (!isMoney(amount) || !isMoney(percent) || percent <= 0) return 0;
  return round2((amount * percent) / 100);
}

/**
 * The "Service fee" on a card taken on a staff phone — Tap to Pay or typed
 * in (Workiz shows it on both): `surchargePercent` of everything the card
 * pays for, the amount AND the tip, rounded half-up to the cent. The phone
 * shows the same number from the same formula,
 * `round2((amount + tip) × pct / 100)`, so what the client is told is what
 * the card is charged. Like the portal's surcharge, it never counts toward
 * the balance.
 */
export function serviceFeeFor(amount: number, tip: number, percent: number): number {
  return surchargeFor(amount + tip, percent);
}

const counts = (status: PaymentStatus) => COUNTED_PAYMENT_STATUSES.includes(status);

/**
 * What one payment contributes to the balance: its gross, less refunds — and
 * never less than nothing. A card payment's tip can be refunded too, so
 * `refundedAmount` may run past `amount`; that part was the tip, which never
 * counted toward the balance in the first place.
 */
const net = (p: Pick<Payment, 'status' | 'amount' | 'refundedAmount'>): number =>
  counts(p.status) ? Math.max(0, p.amount - (p.refundedAmount ?? 0)) : 0;

/** Went through Stripe (a session, an intent or a charge of ours) — as opposed to recorded by hand. */
export const isStripeBacked = (p: Pick<Payment, 'stripePaymentIntentId' | 'stripeSessionId' | 'stripeChargeId'>) =>
  !!(p.stripePaymentIntentId || p.stripeSessionId || p.stripeChargeId);

/**
 * What the customer's card was charged for this payment, dollars: a payment
 * taken through Stripe carried its tip and its fee in the same charge (a
 * phone sends `amount + tipAmount + feeAmount`, the portal its surcharge as a
 * second line), so both are ours to give back. An offline row's tip never
 * passed through billing — only `amount` is.
 */
export function chargedAmount(
  p: Pick<Payment, 'amount' | 'tipAmount' | 'feeAmount' | 'stripePaymentIntentId' | 'stripeSessionId' | 'stripeChargeId'>,
): number {
  return isStripeBacked(p) ? round2(p.amount + (p.tipAmount ?? 0) + (p.feeAmount ?? 0)) : p.amount;
}

export function summarizePayments(payments: readonly Payment[]): PaymentSummary {
  if (payments.length === 0) return { ...EMPTY_PAYMENT_SUMMARY };
  let settledCents = 0;
  let pendingCents = 0;
  let refundedCents = 0;
  let lastPaymentAt: string | undefined;
  for (const p of payments) {
    if (counts(p.status)) {
      settledCents += toCents(net(p));
      refundedCents += toCents(p.refundedAmount ?? 0);
    } else if (p.status === 'pending') {
      pendingCents += toCents(p.amount);
    }
    if ((counts(p.status) || p.status === 'pending') && (!lastPaymentAt || p.takenAt > lastPaymentAt)) {
      lastPaymentAt = p.takenAt;
    }
  }
  return {
    settled: fromCents(settledCents),
    pending: fromCents(pendingCents),
    refunded: fromCents(refundedCents),
    paymentCount: payments.length,
    ...(lastPaymentAt && { lastPaymentAt }),
    hasPending: pendingCents > 0,
  };
}

/** `Invoice.totals.amountPaid` — the one number the invoice status derives from. */
export const amountPaidFrom = (payments: readonly Payment[]): number => summarizePayments(payments).settled;

/** The job board's denormalised flag (deal-service keeps only this). */
export function dealPaymentStatus(amountPaid: number, invoiceTotal: number): 'unpaid' | 'partial' | 'paid' {
  if (toCents(amountPaid) <= 0) return 'unpaid';
  if (toCents(invoiceTotal) <= 0) return 'unpaid';
  return toCents(amountPaid) >= toCents(invoiceTotal) ? 'paid' : 'partial';
}

// ---------------------------------------------------------------- transitions

/**
 * Which status changes a handler may assert. Stripe gives no ordering
 * guarantee, so every move is checked against this rather than trusted:
 *
 *  - `reversed` is terminal. An ACH return or a lost dispute arrives AFTER
 *    the PaymentIntent says `succeeded`, and that intent stays `succeeded`
 *    forever — so a late `payment_intent.succeeded` must change nothing.
 *  - `settled` never goes back to `pending`/`failed` (a replayed
 *    `payment_intent.processing` must not un-settle collected money).
 *  - `failed` may still settle: the same intent can be retried in place.
 *  - `refunded` can still be disputed, but never un-refunds itself.
 */
export const PAYMENT_STATUS_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  pending: ['pending', 'settled', 'failed', 'reversed'],
  settled: ['settled', 'reversed', 'refunded'],
  failed: ['failed', 'pending', 'settled'],
  reversed: ['reversed'],
  refunded: ['refunded', 'reversed'],
};

export const canTransition = (from: PaymentStatus, to: PaymentStatus): boolean =>
  PAYMENT_STATUS_TRANSITIONS[from].includes(to);

// -------------------------------------------------------------------- amounts

export class PaymentAmountError extends Error {
  constructor(
    readonly reason: 'nothing_due' | 'invalid' | 'exceeds_balance' | 'partial_not_allowed' | 'below_bank_minimum',
    message: string,
  ) {
    super(message);
    this.name = 'PaymentAmountError';
  }
}

/**
 * The amount the portal is allowed to charge. Refuses rather than silently
 * capping: a client who typed 1000 on a $100 invoice must be told, not
 * charged $100. The client clamps too; this is the copy that counts.
 */
export function clampPaymentAmount(input: {
  requested: unknown;
  amountDue: number;
  allowPartial: boolean;
  method: OnlinePaymentMethod;
  bankMinimum: number;
}): number {
  const due = round2(isMoney(input.amountDue) ? input.amountDue : 0);
  if (due <= 0) {
    throw new PaymentAmountError('nothing_due', 'There is nothing left to pay on this invoice');
  }
  if (!isMoney(input.requested) || input.requested <= 0) {
    throw new PaymentAmountError('invalid', 'Enter a payment amount greater than zero');
  }
  const amount = round2(input.requested);
  if (amount <= 0) {
    throw new PaymentAmountError('invalid', 'Enter a payment amount greater than zero');
  }
  if (amount > due) {
    throw new PaymentAmountError('exceeds_balance', 'That is more than the balance due on this invoice');
  }
  if (!input.allowPartial && amount < due) {
    throw new PaymentAmountError('partial_not_allowed', 'This invoice must be paid in full');
  }
  if (input.method === 'bank' && amount < round2(input.bankMinimum || 0)) {
    throw new PaymentAmountError(
      'below_bank_minimum',
      `Bank payments have a $${round2(input.bankMinimum).toFixed(2)} minimum — pay by card instead`,
    );
  }
  return amount;
}

// -------------------------------------------------------------------- refunds

type RefundBasis = Pick<
  Payment,
  'amount' | 'tipAmount' | 'feeAmount' | 'stripePaymentIntentId' | 'stripeSessionId' | 'stripeChargeId'
>;

/**
 * What is still refundable: what was charged (`chargedAmount` — the tip and
 * the fee of a Stripe card payment included, as card-network rules expect a
 * surcharge to go back with the sale), less what already went back. Money
 * that never landed, or already came back, is not.
 */
export function refundableAmount(p: RefundBasis & Pick<Payment, 'refundedAmount' | 'status'>): number {
  if (!counts(p.status)) return 0;
  return Math.max(0, round2(chargedAmount(p) - (p.refundedAmount ?? 0)));
}

/** A PARTIAL refund leaves the payment `settled`; only the whole charge makes it `refunded`. */
export function statusAfterRefund(p: RefundBasis, refundedTotal: number): PaymentStatus {
  return toCents(refundedTotal) >= toCents(chargedAmount(p)) ? 'refunded' : 'settled';
}
