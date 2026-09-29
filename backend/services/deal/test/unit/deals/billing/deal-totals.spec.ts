import { dealTotalsSnapshot, totalsBackfillUpdate } from 'src/deals/billing/deal-totals';
import { createMockDeal, createMockDealProduct } from '../../mocks';

describe('dealTotalsSnapshot', () => {
  it('prices the job with the shared formula and adds what its lines cost the company', () => {
    const deal = createMockDeal({ taxRatePercent: 10, discount: { type: 'amount', value: 20 } });
    const lines = [
      createMockDealProduct({ quantity: 2, priceClient: 50, costCompany: 15, taxable: true }),
      createMockDealProduct({ quantity: 1, priceClient: 100, costCompany: 40.5, taxable: false }),
    ];

    expect(dealTotalsSnapshot(deal, lines)).toEqual({
      subtotal: 200,
      discount: 20,
      tax: 9,
      total: 189,
      cost: 70.5,
    });
  });

  it('is all zeros for a job without lines', () => {
    expect(dealTotalsSnapshot(createMockDeal(), [])).toEqual({
      subtotal: 0, discount: 0, tax: 0, total: 0, cost: 0,
    });
  });

  it('counts a line without a company cost as free, in cents', () => {
    const lines = [
      createMockDealProduct({ quantity: 3, priceClient: 0.1, costCompany: 0.1 }),
      createMockDealProduct({ quantity: 1, priceClient: 5, costCompany: undefined as never }),
    ];

    expect(dealTotalsSnapshot(createMockDeal(), lines)).toMatchObject({ subtotal: 5.3, cost: 0.3 });
  });
});

describe('totalsBackfillUpdate', () => {
  const priced = { subtotal: 50, discount: 0, tax: 0, total: 50, cost: 1 };

  it('writes a job that was never priced', () => {
    expect(totalsBackfillUpdate({}, 1, priced)).toEqual({ itemCount: 1, totals: priced });
  });

  it('rewrites a job whose stored money or count drifted', () => {
    expect(totalsBackfillUpdate({ itemCount: 1, totals: { ...priced, tax: 1 } }, 1, priced)).toEqual({
      itemCount: 1,
      totals: priced,
    });
    expect(totalsBackfillUpdate({ itemCount: 2, totals: priced }, 1, priced)).toEqual({ itemCount: 1, totals: priced });
  });

  it('leaves a job that is already right alone', () => {
    expect(totalsBackfillUpdate({ itemCount: 1, totals: { ...priced } }, 1, priced)).toBeNull();
  });
});
