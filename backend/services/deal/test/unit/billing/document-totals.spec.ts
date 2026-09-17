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

describe('lineAmount', () => {
  it('multiplies quantity by price in cents', () => {
    expect(lineAmount({ quantity: 3, priceClient: 19.99 })).toBe(59.97);
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
