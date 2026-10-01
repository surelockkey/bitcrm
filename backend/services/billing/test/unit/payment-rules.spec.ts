import { COUNTED_PAYMENT_STATUSES, type Payment, type PaymentStatus } from '@bitcrm/types';
import {
  PaymentAmountError,
  amountPaidFrom,
  canTransition,
  chargedAmount,
  clampPaymentAmount,
  dealPaymentStatus,
  fromCents,
  refundableAmount,
  statusAfterRefund,
  summarizePayments,
  surchargeFor,
  toCents,
} from 'src/payments/payment-rules';
import { computeInvoiceTotals, deriveInvoiceStatus } from 'src/invoices/invoice-rules';
import { billingView, dealProduct } from './mocks';

const payment = (over: Partial<Payment> = {}): Payment => ({
  id: 'pay-1',
  invoiceId: 'deal-1',
  dealId: 'deal-1',
  contactId: 'contact-1',
  amount: 100,
  currency: 'usd',
  method: 'card',
  status: 'settled',
  refundedAmount: 0,
  source: 'portal',
  takenBy: 'client',
  takenAt: '2026-09-20T10:00:00.000Z',
  version: 1,
  createdAt: '2026-09-20T10:00:00.000Z',
  updatedAt: '2026-09-20T10:00:00.000Z',
  ...over,
});

describe('payment-rules: what the customer has paid', () => {
  it('sums the COUNTED statuses and subtracts refunds', () => {
    // A `refunded` payment is still counted gross — its refund cancels it out.
    const rows = [
      payment({ id: 'a', amount: 100, status: 'settled' }),
      payment({ id: 'b', amount: 50, status: 'settled', refundedAmount: 20 }),
      payment({ id: 'c', amount: 30, status: 'refunded', refundedAmount: 30 }),
    ];
    expect(amountPaidFrom(rows)).toBe(130);
    expect(COUNTED_PAYMENT_STATUSES).toEqual(['settled', 'refunded']);
  });

  it('never counts a pending (ACH in transit) payment', () => {
    const rows = [payment({ id: 'a', amount: 100, status: 'pending', method: 'bank' })];
    const summary = summarizePayments(rows);
    expect(summary.settled).toBe(0);
    expect(summary.pending).toBe(100);
    expect(summary.hasPending).toBe(true);
    expect(amountPaidFrom(rows)).toBe(0);
  });

  it('never counts failed or reversed money', () => {
    const rows = [
      payment({ id: 'a', amount: 100, status: 'failed' }),
      payment({ id: 'b', amount: 70, status: 'reversed' }),
      payment({ id: 'c', amount: 25, status: 'settled' }),
    ];
    expect(amountPaidFrom(rows)).toBe(25);
    expect(summarizePayments(rows).settled).toBe(25);
  });

  it('summarises count, refunds and the last payment time', () => {
    const rows = [
      payment({ id: 'a', amount: 100, takenAt: '2026-09-18T10:00:00.000Z' }),
      payment({ id: 'b', amount: 40, refundedAmount: 15, takenAt: '2026-09-21T09:00:00.000Z' }),
      payment({ id: 'c', amount: 10, status: 'failed', takenAt: '2026-09-25T09:00:00.000Z' }),
    ];
    const s = summarizePayments(rows);
    expect(s).toEqual({
      settled: 125,
      pending: 0,
      refunded: 15,
      paymentCount: 3,
      lastPaymentAt: '2026-09-21T09:00:00.000Z',
      hasPending: false,
    });
  });

  it('rounds to cents rather than carrying float dust', () => {
    const rows = [payment({ id: 'a', amount: 0.1 }), payment({ id: 'b', amount: 0.2 })];
    expect(amountPaidFrom(rows)).toBe(0.3);
  });

  it('never counts a tip toward the balance, and a refunded tip never pushes the balance below what was paid', () => {
    const tapped = payment({ id: 't', amount: 100, tipAmount: 15, stripePaymentIntentId: 'pi_1' });
    expect(summarizePayments([tapped]).settled).toBe(100);
    // The job's part went back, the tip was kept: the job is owed again in full.
    expect(summarizePayments([{ ...tapped, refundedAmount: 100 }]).settled).toBe(0);
    // Everything went back, the tip included: this payment counts for nothing — not −15.
    const all = { ...tapped, status: 'refunded' as const, refundedAmount: 115 };
    expect(summarizePayments([all, payment({ id: 'other', amount: 40 })])).toMatchObject({ settled: 40, refunded: 115 });
  });
});

describe('payment-rules: the invoice status the ledger implies', () => {
  const view = billingView({}, [dealProduct({ quantity: 1, priceClient: 100, taxable: false })]);
  const today = '2026-09-20';
  const dueDate = '2026-09-30';

  it('leaves a partially paid invoice `due`', () => {
    const totals = computeInvoiceTotals(view, { amountPaid: 40 });
    expect(totals.balanceDue).toBe(60);
    expect(deriveInvoiceStatus({ totals, dueDate, today })).toBe('due');
  });

  it('leaves a partially paid, past-due invoice `overdue`', () => {
    const totals = computeInvoiceTotals(view, { amountPaid: 40 });
    expect(deriveInvoiceStatus({ totals, dueDate: '2026-09-01', today })).toBe('overdue');
  });

  it('marks it paid once the ledger covers the total', () => {
    const totals = computeInvoiceTotals(view, { amountPaid: 100 });
    expect(totals.balanceDue).toBe(0);
    expect(deriveInvoiceStatus({ totals, dueDate, today })).toBe('paid');
  });

  it('pushes a paid invoice back to due when a payment is reversed', () => {
    const paid = computeInvoiceTotals(view, { amountPaid: 100 });
    expect(deriveInvoiceStatus({ totals: paid, dueDate, today })).toBe('paid');
    // The reversal removes that payment from the counted sum.
    const after = computeInvoiceTotals(view, { amountPaid: 0 });
    expect(after.balanceDue).toBe(100);
    expect(deriveInvoiceStatus({ totals: after, dueDate, today })).toBe('due');
    expect(deriveInvoiceStatus({ totals: after, dueDate: '2026-09-01', today })).toBe('overdue');
  });

  it('ignores the job’s stale `paid` flag when the ledger is the source', () => {
    const stale = billingView({ paymentStatus: 'paid', actualTotal: 100 }, [
      dealProduct({ quantity: 1, priceClient: 100, taxable: false }),
    ]);
    const totals = computeInvoiceTotals(stale, { amountPaid: 0 });
    expect(totals.balanceDue).toBe(100);
    expect(deriveInvoiceStatus({ totals, dueDate, today })).toBe('due');
  });

  it('keeps the legacy deal-driven behaviour when no ledger is supplied', () => {
    const legacy = billingView({ paymentStatus: 'paid', actualTotal: 100 }, [
      dealProduct({ quantity: 1, priceClient: 100, taxable: false }),
    ]);
    expect(computeInvoiceTotals(legacy).balanceDue).toBe(0);
  });

  it('maps the ledger onto the job board’s payment status', () => {
    expect(dealPaymentStatus(0, 100)).toBe('unpaid');
    expect(dealPaymentStatus(40, 100)).toBe('partial');
    expect(dealPaymentStatus(100, 100)).toBe('paid');
    expect(dealPaymentStatus(120, 100)).toBe('paid');
    // Nothing billed, nothing paid: not "paid".
    expect(dealPaymentStatus(0, 0)).toBe('unpaid');
  });
});

describe('payment-rules: money crosses the Stripe boundary once', () => {
  it('converts dollars to cents without float dust', () => {
    expect(toCents(19.99)).toBe(1999);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(1234.565)).toBe(123457);
    expect(fromCents(1999)).toBe(19.99);
  });

  it('computes a surcharge at 2dp, and nothing at all when it is off', () => {
    expect(surchargeFor(100, 0)).toBe(0);
    expect(surchargeFor(100, 3)).toBe(3);
    expect(surchargeFor(19.99, 3)).toBe(0.6);
  });
});

describe('payment-rules: status transitions never regress', () => {
  it('lets a pending payment settle or fail', () => {
    expect(canTransition('pending', 'settled')).toBe(true);
    expect(canTransition('pending', 'failed')).toBe(true);
    expect(canTransition('pending', 'reversed')).toBe(true);
  });

  it('refuses to resurrect a reversed payment — a late success changes nothing', () => {
    expect(canTransition('reversed', 'settled')).toBe(false);
    expect(canTransition('reversed', 'pending')).toBe(false);
    expect(canTransition('reversed', 'failed')).toBe(false);
    expect(canTransition('reversed', 'reversed')).toBe(true);
  });

  it('refuses to un-settle a settled payment, but allows the money coming back', () => {
    expect(canTransition('settled', 'pending')).toBe(false);
    expect(canTransition('settled', 'failed')).toBe(false);
    expect(canTransition('settled', 'reversed')).toBe(true);
    expect(canTransition('settled', 'refunded')).toBe(true);
  });

  it('lets a failed attempt still land (same intent retried) but never reverses on its own', () => {
    expect(canTransition('failed', 'settled')).toBe(true);
    expect(canTransition('failed', 'pending')).toBe(true);
    expect(canTransition('failed', 'reversed')).toBe(false);
  });

  it('keeps a fully refunded payment refunded, except for a dispute', () => {
    expect(canTransition('refunded', 'settled')).toBe(false);
    expect(canTransition('refunded', 'pending')).toBe(false);
    expect(canTransition('refunded', 'reversed')).toBe(true);
  });

  it('is reflexive for every status (a replayed webhook is a no-op, not an error)', () => {
    for (const s of ['pending', 'settled', 'failed', 'reversed', 'refunded'] as PaymentStatus[]) {
      expect(canTransition(s, s)).toBe(true);
    }
  });
});

describe('payment-rules: the amount the portal may charge', () => {
  const base = { amountDue: 100, allowPartial: true, method: 'card' as const, bankMinimum: 20 };

  it('accepts a full payment and a partial one', () => {
    expect(clampPaymentAmount({ ...base, requested: 100 })).toBe(100);
    expect(clampPaymentAmount({ ...base, requested: 40 })).toBe(40);
  });

  it('refuses zero and negative amounts', () => {
    expect(() => clampPaymentAmount({ ...base, requested: 0 })).toThrow(PaymentAmountError);
    expect(() => clampPaymentAmount({ ...base, requested: -5 })).toThrow(PaymentAmountError);
  });

  it('refuses a non-number, NaN or Infinity', () => {
    for (const bad of ['abc', NaN, Infinity, null, undefined, {}]) {
      expect(() => clampPaymentAmount({ ...base, requested: bad })).toThrow(PaymentAmountError);
    }
  });

  it('refuses more than the balance rather than quietly capping it', () => {
    expect(() => clampPaymentAmount({ ...base, requested: 100.01 })).toThrow(/more than the balance/i);
  });

  it('refuses anything when nothing is owed', () => {
    expect(() => clampPaymentAmount({ ...base, amountDue: 0, requested: 10 })).toThrow(/nothing/i);
  });

  it('refuses a partial payment when the account does not allow one', () => {
    expect(clampPaymentAmount({ ...base, allowPartial: false, requested: 100 })).toBe(100);
    expect(() => clampPaymentAmount({ ...base, allowPartial: false, requested: 40 })).toThrow(/full/i);
  });

  it('refuses a bank payment under the account minimum', () => {
    expect(() => clampPaymentAmount({ ...base, method: 'bank', requested: 19.99 })).toThrow(/minimum/i);
    expect(clampPaymentAmount({ ...base, method: 'bank', requested: 20 })).toBe(20);
  });

  it('rounds the accepted amount to cents', () => {
    expect(clampPaymentAmount({ ...base, requested: 33.333 })).toBe(33.33);
  });
});

describe('payment-rules: refunds', () => {
  it('knows what is left to give back', () => {
    expect(refundableAmount(payment({ amount: 100, refundedAmount: 0 }))).toBe(100);
    expect(refundableAmount(payment({ amount: 100, refundedAmount: 30 }))).toBe(70);
    expect(refundableAmount(payment({ amount: 100, refundedAmount: 100, status: 'refunded' }))).toBe(0);
    // Money that never landed, or already came back, cannot be refunded.
    expect(refundableAmount(payment({ status: 'pending' }))).toBe(0);
    expect(refundableAmount(payment({ status: 'failed' }))).toBe(0);
    expect(refundableAmount(payment({ status: 'reversed' }))).toBe(0);
  });

  it('leaves a partially refunded payment settled, and a fully refunded one refunded', () => {
    expect(statusAfterRefund(payment({ amount: 100 }), 30)).toBe('settled');
    expect(statusAfterRefund(payment({ amount: 100 }), 100)).toBe('refunded');
    expect(statusAfterRefund(payment({ amount: 100 }), 99.995)).toBe('refunded');
  });

  it('gives back the tip of a card payment taken through Stripe as well — it was charged with it', () => {
    const tapped = payment({ amount: 100, tipAmount: 15, stripePaymentIntentId: 'pi_1' });
    expect(chargedAmount(tapped)).toBe(115);
    expect(refundableAmount(tapped)).toBe(115);
    expect(refundableAmount({ ...tapped, refundedAmount: 100 })).toBe(15);
    // Only the whole charge, tip included, makes it `refunded`.
    expect(statusAfterRefund(tapped, 100)).toBe('settled');
    expect(statusAfterRefund(tapped, 115)).toBe('refunded');
  });

  it('keeps the tip of an offline payment out of it — billing never took that money', () => {
    const cash = payment({ amount: 100, tipAmount: 15, method: 'cash', source: 'office' });
    expect(chargedAmount(cash)).toBe(100);
    expect(refundableAmount(cash)).toBe(100);
    expect(statusAfterRefund(cash, 100)).toBe('refunded');
  });
});
