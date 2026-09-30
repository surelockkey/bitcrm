import {
  calculateDocumentTotals,
  effectiveTaxRatePercent,
  lineAmount,
  type TaxRate,
} from '@bitcrm/types';

const rate = (over: Partial<TaxRate>): TaxRate => ({
  id: 'r',
  name: 'r',
  ratePercent: 0,
  isDefault: false,
  active: true,
  isGroup: false,
  componentIds: [],
  createdBy: 'u',
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('calculateDocumentTotals', () => {
  it('returns zeros for no lines', () => {
    const t = calculateDocumentTotals({ lines: [], taxRatePercent: 8 });
    expect(t).toMatchObject({ subtotal: 0, discount: 0, tax: 0, total: 0, balanceDue: 0, lineCount: 0 });
  });

  it('taxes every line when taxable is absent (legacy default true)', () => {
    const t = calculateDocumentTotals({
      lines: [
        { quantity: 2, priceClient: 50 },
        { quantity: 1, priceClient: 100 },
      ],
      taxRatePercent: 7,
    });
    expect(t.subtotal).toBe(200);
    expect(t.taxableSubtotal).toBe(200);
    expect(t.tax).toBe(14);
    expect(t.total).toBe(214);
  });

  it('only taxes taxable lines', () => {
    const t = calculateDocumentTotals({
      lines: [
        { quantity: 1, priceClient: 100, taxable: true },
        { quantity: 1, priceClient: 50, taxable: false },
      ],
      taxRatePercent: 10,
    });
    expect(t.taxableSubtotal).toBe(100);
    expect(t.nonTaxableSubtotal).toBe(50);
    expect(t.tax).toBe(10);
    expect(t.total).toBe(160);
  });

  it('applies a percent discount before tax, split proportionally', () => {
    const t = calculateDocumentTotals({
      lines: [
        { quantity: 1, priceClient: 100, taxable: true },
        { quantity: 1, priceClient: 100, taxable: false },
      ],
      taxRatePercent: 10,
      discount: { type: 'percent', value: 10 },
    });
    expect(t.discount).toBe(20);
    expect(t.taxableBase).toBe(90);
    expect(t.tax).toBe(9);
    expect(t.total).toBe(189);
  });

  it('applies an amount discount and caps it at the subtotal', () => {
    const t = calculateDocumentTotals({
      lines: [{ quantity: 1, priceClient: 30 }],
      taxRatePercent: 10,
      discount: { type: 'amount', value: 50 },
    });
    expect(t.discount).toBe(30);
    expect(t.tax).toBe(0);
    expect(t.total).toBe(0);
  });

  it('clamps percent discount to 0..100 and ignores negatives', () => {
    expect(
      calculateDocumentTotals({ lines: [{ quantity: 1, priceClient: 10 }], discount: { type: 'percent', value: 150 } })
        .discount,
    ).toBe(10);
    expect(
      calculateDocumentTotals({ lines: [{ quantity: 1, priceClient: 10 }], discount: { type: 'amount', value: -5 } })
        .discount,
    ).toBe(0);
  });

  it('rounds half-up on cents once', () => {
    const t = calculateDocumentTotals({
      lines: [{ quantity: 3, priceClient: 0.335 }],
      taxRatePercent: 6.35,
    });
    expect(t.subtotal).toBe(1.01);
    expect(t.tax).toBe(0.06);
    expect(t.total).toBe(1.07);
  });

  it('computes balance due from amountPaid', () => {
    const t = calculateDocumentTotals({
      lines: [{ quantity: 1, priceClient: 100 }],
      taxRatePercent: 0,
      amountPaid: 40,
    });
    expect(t.amountPaid).toBe(40);
    expect(t.balanceDue).toBe(60);
  });

  it('treats a missing tax rate as zero', () => {
    expect(calculateDocumentTotals({ lines: [{ quantity: 1, priceClient: 10 }] }).tax).toBe(0);
  });
});

/**
 * Amounts from real Workiz invoices and jobs (nothing else kept). Each one
 * is what Workiz billed; the formula before this rule missed it by a cent or
 * a few, and that gap sat on the imported invoice as a phantom balance.
 */
describe('calculateDocumentTotals — the Workiz rule', () => {
  const money = (t: ReturnType<typeof calculateDocumentTotals>) => ({
    subtotal: t.subtotal,
    discount: t.discount,
    tax: t.tax,
    total: t.total,
  });

  it('taxes the unrounded line amount (a price backed out of a tax-inclusive $155)', () => {
    // Rounding the line to 145.75 first gave tax 9.26 and a total of 155.01.
    const t = calculateDocumentTotals({ lines: [{ quantity: 1, priceClient: 145.745 }], taxRatePercent: 6.35 });
    expect(money(t)).toEqual({ subtotal: 145.75, discount: 0, tax: 9.25, total: 155 });
  });

  it('rounds the tax up when the unrounded amount says so ($325 inclusive)', () => {
    // Was 19.40 and 324.99.
    const t = calculateDocumentTotals({ lines: [{ quantity: 1, priceClient: 305.593 }], taxRatePercent: 6.35 });
    expect(money(t)).toEqual({ subtotal: 305.59, discount: 0, tax: 19.41, total: 325 });
  });

  it('rounds the decimal value, not its binary approximation (410 × 6.35% = 26.035)', () => {
    // 41000 × 6.35 / 100 is 2603.4999999999995 in floating point: was 26.03.
    const t = calculateDocumentTotals({
      lines: [
        { quantity: 1, priceClient: 350 },
        { quantity: 1, priceClient: 30 },
        { quantity: 1, priceClient: 30 },
      ],
      taxRatePercent: 6.35,
    });
    expect(money(t)).toEqual({ subtotal: 410, discount: 0, tax: 26.04, total: 436.04 });
  });

  it('prices fractional hours without rounding the line first', () => {
    const t = calculateDocumentTotals({
      lines: [
        { quantity: 1, priceClient: 495.99 },
        { quantity: 1, priceClient: 399.99 },
        { quantity: 1.5, priceClient: 145.99 },
      ],
      taxRatePercent: 6.35,
    });
    expect(money(t)).toEqual({ subtotal: 1114.97, discount: 0, tax: 70.8, total: 1185.77 });
  });

  it('keeps a non-discountable line (the card service fee) out of an amount discount', () => {
    // With the fee sharing the discount the taxable base was 166.68: tax 13.75, total 185.43.
    const t = calculateDocumentTotals({
      lines: [
        { quantity: 1, priceClient: 180 },
        { quantity: 1, priceClient: 5.4, taxable: false, discountable: false },
      ],
      taxRatePercent: 8.25,
      discount: { type: 'amount', value: 13.72 },
    });
    expect(t.taxableBase).toBe(166.28);
    expect(money(t)).toEqual({ subtotal: 185.4, discount: 13.72, tax: 13.72, total: 185.4 });
  });

  it('takes a percent discount of the discountable lines only', () => {
    // 10% of the $63 service, not of 63 + the 1.85 fee. Workiz: 63.65 with a 1.50 tip.
    const t = calculateDocumentTotals({
      lines: [
        { quantity: 1, priceClient: 63 },
        { quantity: 1, priceClient: 1.85, taxable: false, discountable: false },
      ],
      taxRatePercent: 6.35,
      discount: { type: 'percent', value: 10 },
    });
    expect(money(t)).toEqual({ subtotal: 64.85, discount: 6.3, tax: 3.6, total: 62.15 });
  });

  it('combines fractional hours, a fee and a discount', () => {
    // Was tax 67.40 and 897.34.
    const t = calculateDocumentTotals({
      lines: [
        { quantity: 1.5, priceClient: 125 },
        { quantity: 1, priceClient: 13.26, taxable: false, discountable: false },
        { quantity: 1, priceClient: 647.18 },
      ],
      taxRatePercent: 8.25,
      discount: { type: 'amount', value: 18 },
    });
    expect(money(t)).toEqual({ subtotal: 847.94, discount: 18, tax: 67.38, total: 897.32 });
  });

  it('shares a discount between taxable and non-taxable lines by amount', () => {
    const t = calculateDocumentTotals({
      lines: [
        { quantity: 1, priceClient: 105 },
        { quantity: 1, priceClient: 790, taxable: false },
        { quantity: 1, priceClient: 300, taxable: false },
      ],
      taxRatePercent: 8.25,
      discount: { type: 'amount', value: 3.64 },
    });
    expect(t.taxableBase).toBe(104.68);
    expect(money(t)).toEqual({ subtotal: 1195, discount: 3.64, tax: 8.64, total: 1200 });
  });

  it('rounds the discounted subtotal once, so a half-cent discount keeps the total Workiz billed', () => {
    // 2% of 97.25 is 1.945: Workiz bills 95.305 → 95.31 (was 95.30). The
    // discount shown is what the total actually lost, so the document adds up.
    const t = calculateDocumentTotals({
      lines: [
        { quantity: 3, priceClient: 4.9, taxable: false },
        { quantity: 5, priceClient: 3.85, taxable: false },
        { quantity: 4, priceClient: 14.65, taxable: false },
        { quantity: 5, priceClient: 0.94, taxable: false },
      ],
      taxRatePercent: 8.25,
      discount: { type: 'percent', value: 2 },
    });
    expect(money(t)).toEqual({ subtotal: 97.25, discount: 1.94, tax: 0, total: 95.31 });
  });

  it('charges no tax on a negative taxable base (a credit line)', () => {
    // Was tax −0.51 and total −0.51.
    const t = calculateDocumentTotals({
      lines: [
        { quantity: 1, priceClient: 29.99 },
        { quantity: 1, priceClient: 7.98, taxable: false, discountable: false },
        { quantity: 1, priceClient: 220 },
        { quantity: 1, priceClient: -257.97 },
      ],
      taxRatePercent: 6.35,
    });
    expect(money(t)).toEqual({ subtotal: 0, discount: 0, tax: 0, total: 0 });
  });

  it('caps a discount at the discountable lines', () => {
    const t = calculateDocumentTotals({
      lines: [
        { quantity: 1, priceClient: 30 },
        { quantity: 1, priceClient: 2, taxable: false, discountable: false },
      ],
      taxRatePercent: 10,
      discount: { type: 'amount', value: 50 },
    });
    expect(money(t)).toEqual({ subtotal: 32, discount: 30, tax: 0, total: 2 });
  });

  it('always adds up: subtotal − discount + tax = total', () => {
    const t = calculateDocumentTotals({
      lines: [
        { quantity: 1.05, priceClient: 46.01 },
        { quantity: 1, priceClient: 1.47, taxable: false, discountable: false },
        { quantity: 1, priceClient: 232.39 },
      ],
      taxRatePercent: 6.35,
      discount: { type: 'percent', value: 7.5 },
    });
    expect(Math.round((t.subtotal - t.discount + t.tax) * 100)).toBe(Math.round(t.total * 100));
  });
});

describe('lineAmount', () => {
  it('multiplies quantity by price in cents', () => {
    expect(lineAmount({ quantity: 3, priceClient: 19.99 })).toBe(59.97);
  });

  it('rounds a half cent up on the decimal value', () => {
    // 10.075 is stored as 10.07499…; the line still shows 10.08.
    expect(lineAmount({ quantity: 1, priceClient: 10.075 })).toBe(10.08);
    expect(lineAmount({ quantity: 1.15, priceClient: 100.5 })).toBe(115.58);
  });
});

describe('effectiveTaxRatePercent', () => {
  it('returns the plain rate', () => {
    expect(effectiveTaxRatePercent(rate({ ratePercent: 6.35 }), [])).toBe(6.35);
  });

  it('sums a group from its active components', () => {
    const gst = rate({ id: 'gst', ratePercent: 5 });
    const pst = rate({ id: 'pst', ratePercent: 7 });
    const off = rate({ id: 'off', ratePercent: 3, active: false });
    const group = rate({ id: 'g', isGroup: true, componentIds: ['gst', 'pst', 'off', 'missing'] });
    expect(effectiveTaxRatePercent(group, [gst, pst, off])).toBe(12);
  });
});
