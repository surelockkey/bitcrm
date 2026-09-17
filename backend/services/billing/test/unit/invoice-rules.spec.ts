import { PaymentTerms, DEFAULT_BUSINESS_PROFILE, type BusinessProfile, type Deal, type DealProduct } from '@bitcrm/types';
import {
  computeDueDate,
  computeInvoiceTotals,
  deriveInvoiceStatus,
  dueDateBasisDate,
  paymentTermsLabel,
  resolvePaymentTerms,
  termDays,
} from 'src/invoices/invoice-rules';
import { addDays, formatDisplayDate, todayIn } from 'src/common/dates';

const profile = (over: Partial<BusinessProfile> = {}): BusinessProfile => ({
  ...DEFAULT_BUSINESS_PROFILE,
  ...over,
});

const line = (over: Partial<DealProduct> = {}): DealProduct => ({
  productId: 'p1',
  name: 'Rekey',
  sku: 'RK',
  quantity: 1,
  costCompany: 10,
  costForTech: 5,
  priceClient: 100,
  addedBy: 'u',
  addedAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

describe('dates', () => {
  it('adds days across month ends', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-20', 15)).toBe('2027-01-04');
    expect(addDays('2026-03-01', 0)).toBe('2026-03-01');
  });

  it('gives today in a timezone', () => {
    // 2026-09-16 02:00 UTC is still the 15th in New York.
    expect(todayIn('America/New_York', new Date('2026-09-16T02:00:00Z'))).toBe('2026-09-15');
    expect(todayIn('UTC', new Date('2026-09-16T02:00:00Z'))).toBe('2026-09-16');
  });

  it('formats "MMM d, yyyy" without shifting date-only values', () => {
    expect(formatDisplayDate('2026-09-05', 'America/Los_Angeles')).toBe('Sep 5, 2026');
    expect(formatDisplayDate('2026-09-16T02:00:00Z', 'America/New_York')).toBe('Sep 15, 2026');
    expect(formatDisplayDate(undefined, 'UTC')).toBeUndefined();
  });
});

describe('payment terms', () => {
  it('prefers the contact terms, then the company, then the profile default', () => {
    expect(
      resolvePaymentTerms({ paymentTerms: PaymentTerms.NET_15 }, { paymentTerms: PaymentTerms.NET_60 }, profile()),
    ).toEqual({ terms: PaymentTerms.NET_15, days: 15 });
    expect(resolvePaymentTerms(null, { paymentTerms: PaymentTerms.NET_60 }, profile())).toEqual({
      terms: PaymentTerms.NET_60,
      days: 60,
    });
    expect(
      resolvePaymentTerms(null, null, profile({ defaultPaymentTerms: PaymentTerms.NET_30 })),
    ).toEqual({ terms: PaymentTerms.NET_30, days: 30 });
  });

  it('cash is due the same day', () => {
    expect(termDays(PaymentTerms.CASH)).toBe(0);
    expect(resolvePaymentTerms(null, null, profile())).toEqual({ terms: PaymentTerms.CASH, days: 0 });
  });

  it('custom uses the company days, else the profile defaultCustomTermDays', () => {
    expect(
      resolvePaymentTerms(
        null,
        { paymentTerms: PaymentTerms.CUSTOM, customTermsDays: 45 },
        profile({ defaultCustomTermDays: 10 }),
      ),
    ).toEqual({ terms: PaymentTerms.CUSTOM, days: 45 });
    expect(
      resolvePaymentTerms(
        null,
        { paymentTerms: PaymentTerms.CUSTOM },
        profile({ defaultCustomTermDays: 10 }),
      ),
    ).toEqual({ terms: PaymentTerms.CUSTOM, days: 10 });
    expect(
      resolvePaymentTerms(
        null,
        null,
        profile({ defaultPaymentTerms: PaymentTerms.CUSTOM, defaultCustomTermDays: 21 }),
      ),
    ).toEqual({ terms: PaymentTerms.CUSTOM, days: 21 });
  });

  it('labels terms', () => {
    expect(paymentTermsLabel(PaymentTerms.CASH)).toBe('Due on receipt');
    expect(paymentTermsLabel(PaymentTerms.NET_30)).toBe('Net 30');
    expect(paymentTermsLabel(PaymentTerms.CUSTOM, 12)).toBe('Net 12');
  });
});

describe('due date', () => {
  const deal = {
    createdAt: '2026-08-01T03:00:00.000Z',
    scheduledDate: '2026-08-10',
  } as Deal;

  it('counts from the invoice date by default', () => {
    expect(
      dueDateBasisDate(profile(), { invoiceDate: '2026-09-16', deal, timezone: 'America/New_York' }),
    ).toBe('2026-09-16');
  });

  it('counts from the job creation day in the job timezone', () => {
    expect(
      dueDateBasisDate(profile({ dueDateBasis: 'job_created' }), {
        invoiceDate: '2026-09-16',
        deal,
        timezone: 'America/New_York',
      }),
    ).toBe('2026-07-31');
  });

  it('counts from the scheduled date, falling back to the invoice date', () => {
    const p = profile({ dueDateBasis: 'job_scheduled' });
    expect(dueDateBasisDate(p, { invoiceDate: '2026-09-16', deal, timezone: 'UTC' })).toBe('2026-08-10');
    expect(
      dueDateBasisDate(p, {
        invoiceDate: '2026-09-16',
        deal: { ...deal, scheduledDate: undefined },
        timezone: 'UTC',
      }),
    ).toBe('2026-09-16');
  });

  it('adds the term days', () => {
    expect(computeDueDate('2026-09-16', 0)).toBe('2026-09-16');
    expect(computeDueDate('2026-09-16', 15)).toBe('2026-10-01');
    expect(computeDueDate('2026-09-16', 30)).toBe('2026-10-16');
    expect(computeDueDate('2026-09-16', 60)).toBe('2026-11-15');
  });
});

describe('invoice totals + derived status', () => {
  const baseDeal = { taxRatePercent: 10 } as Deal;

  it('computes totals from the job lines, tax and discount', () => {
    const totals = computeInvoiceTotals({
      deal: { ...baseDeal, discount: { type: 'amount', value: 10 } },
      items: [line(), line({ productId: 'p2', priceClient: 50, taxable: false })],
    });
    expect(totals.subtotal).toBe(150);
    expect(totals.discount).toBe(10);
    expect(totals.total).toBeGreaterThan(140);
    expect(totals.amountPaid).toBe(0);
  });

  it('takes amountPaid from actualTotal when the job is paid', () => {
    const totals = computeInvoiceTotals({
      deal: { ...baseDeal, paymentStatus: 'paid', actualTotal: 60 },
      items: [line()],
    });
    expect(totals.total).toBe(110);
    expect(totals.amountPaid).toBe(60);
    expect(totals.balanceDue).toBe(50);
  });

  it('treats a paid job without actualTotal as fully paid', () => {
    const totals = computeInvoiceTotals({
      deal: { ...baseDeal, paymentStatus: 'paid' },
      items: [line()],
    });
    expect(totals.amountPaid).toBe(110);
    expect(totals.balanceDue).toBe(0);
  });

  const totalsOf = (total: number, paid = 0) =>
    ({ total, amountPaid: paid, balanceDue: total - paid }) as never;

  it('no_amount when the total is zero', () => {
    expect(deriveInvoiceStatus({ totals: totalsOf(0), dueDate: '2026-01-01', today: '2026-09-16' })).toBe(
      'no_amount',
    );
  });

  it('paid when the job payment status is paid', () => {
    expect(
      deriveInvoiceStatus({
        totals: totalsOf(100, 20),
        dueDate: '2026-01-01',
        today: '2026-09-16',
        paymentStatus: 'paid',
      }),
    ).toBe('paid');
  });

  it('paid when the balance is settled on a positive total', () => {
    expect(
      deriveInvoiceStatus({ totals: totalsOf(100, 100), dueDate: '2026-01-01', today: '2026-09-16' }),
    ).toBe('paid');
  });

  it('overdue once the due date has passed, due on and before it', () => {
    expect(
      deriveInvoiceStatus({ totals: totalsOf(100), dueDate: '2026-09-15', today: '2026-09-16' }),
    ).toBe('overdue');
    expect(
      deriveInvoiceStatus({ totals: totalsOf(100), dueDate: '2026-09-16', today: '2026-09-16' }),
    ).toBe('due');
    expect(
      deriveInvoiceStatus({ totals: totalsOf(100), dueDate: '2026-10-16', today: '2026-09-16' }),
    ).toBe('due');
  });
});
