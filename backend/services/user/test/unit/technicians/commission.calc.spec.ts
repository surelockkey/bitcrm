import { calculateCommission } from '../../../src/technicians/commission/commission.calc';

const config = { baseRatePct: 40, creditCardFeePct: 3, achFeePct: 0 };

describe('calculateCommission', () => {
  it('matches the EPIC-6 worked example when paid by credit card ($100.30)', () => {
    const r = calculateCommission(config, {
      revenue: 350,
      tax: 28,
      partsCost: 45,
      paidByCard: true,
    });
    expect(r.baseProfit).toBe(277);
    expect(r.techShare).toBe(110.8);
    expect(r.deduction).toBe(10.5);
    expect(r.netPayout).toBe(100.3);
  });

  it('matches the EPIC-6 worked example when paid by ACH ($110.80)', () => {
    const r = calculateCommission(config, {
      revenue: 350,
      tax: 28,
      partsCost: 45,
      paidByCard: false,
    });
    expect(r.deduction).toBe(0);
    expect(r.netPayout).toBe(110.8);
  });

  it('handles zero parts and rounds to cents', () => {
    const r = calculateCommission(
      { baseRatePct: 33.33, creditCardFeePct: 3, achFeePct: 0 },
      { revenue: 100, tax: 0, partsCost: 0, paidByCard: false },
    );
    expect(r.baseProfit).toBe(100);
    expect(r.techShare).toBe(33.33);
    expect(r.netPayout).toBe(33.33);
  });

  it('applies a non-zero ACH fee when configured', () => {
    const r = calculateCommission(
      { baseRatePct: 50, creditCardFeePct: 3, achFeePct: 1 },
      { revenue: 200, tax: 0, partsCost: 0, paidByCard: false },
    );
    expect(r.deduction).toBe(2); // 200 * 1%
    expect(r.netPayout).toBe(98); // 100 - 2
  });
});
