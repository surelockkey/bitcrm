import type { CommissionConfig } from '@bitcrm/types';
import {
  calculateWorkizCommission,
  configInForce,
  resolveWorkizRate,
  round2,
  splitWorkizPayments,
  workizBalance,
  type WorkizCommissionInput,
} from 'src/commission-report/workiz-commission.calc';

const noFees = { creditPct: 0, cashPct: 0, checkPct: 0 };
const nothingPaid = { cash: 0, credit: 0, check: 0 };

function input(overrides: Partial<WorkizCommissionInput>): WorkizCommissionInput {
  return {
    total: 0,
    tax: 0,
    tip: 0,
    parts: 0,
    companyParts: 0,
    paid: nothingPaid,
    fees: noFees,
    rate: 0,
    rateUnit: '%',
    ...overrides,
  };
}

const config = (overrides: Partial<CommissionConfig>): CommissionConfig => ({
  userId: 'tech-1',
  baseRatePct: 30,
  creditCardFeePct: 3,
  achFeePct: 0,
  effectiveDate: '2025-01-01T00:00:00.000Z',
  createdBy: 'u',
  createdAt: '2025-01-01T00:00:00.000Z',
  ...overrides,
});

describe('calculateWorkizCommission — the rows of the live Workiz report', () => {
  it('TGQ6NS: 50 %, card fee 2.91 % taken before the split, tech parts off the top', () => {
    const r = calculateWorkizCommission(
      input({
        total: 197.17,
        tax: 11.43,
        parts: 82.74,
        paid: { cash: 0, credit: 197.17, check: 0 },
        fees: { creditPct: 2.91, cashPct: 0, checkPct: 0 },
        rate: 50,
      }),
    );
    expect(r.techProfit).toBe(48.63);
    expect(r.companyProfit).toBe(54.37);
    expect(r.billing).toBe(0);
  });

  it('PS5CTO: 30 %, card fee 6 %, company parts off the top', () => {
    const r = calculateWorkizCommission(
      input({
        total: 1617.78,
        companyParts: 842.3,
        paid: { cash: 0, credit: 1617.78, check: 0 },
        fees: { creditPct: 6, cashPct: 0, checkPct: 0 },
        rate: 30,
      }),
    );
    expect(r.techProfit).toBe(203.52);
    expect(r.companyProfit).toBe(571.96);
  });

  it('SW0X6O: 31 % paid by check with no check fee', () => {
    const r = calculateWorkizCommission(
      input({
        total: 934.44,
        tax: 71.22,
        paid: { cash: 0, credit: 0, check: 934.44 },
        fees: { creditPct: 3, cashPct: 0, checkPct: 0 },
        rate: 31,
      }),
    );
    expect(r.techProfit).toBe(267.6);
    expect(r.companyProfit).toBe(595.62);
  });

  it('FZ9LNN: the tip is not split — it goes to the technician whole', () => {
    const r = calculateWorkizCommission(
      input({
        total: 368.06,
        tax: 17.78,
        tip: 59.56,
        parts: 15,
        paid: { cash: 0, credit: 368.06, check: 0 },
        fees: { creditPct: 6, cashPct: 0, checkPct: 0 },
        rate: 40,
      }),
    );
    expect(r.techProfit).toBe(161.01);
    expect(r.companyProfit).toBe(174.27);
  });

  it('3BFA5S: a fixed $165 rate pays $165 whatever the total', () => {
    const r = calculateWorkizCommission(
      input({ total: 210, paid: { cash: 210, credit: 0, check: 0 }, rate: 165, rateUnit: '$' }),
    );
    expect(r.techProfit).toBe(165);
    expect(r.companyProfit).toBe(45);
  });

  it('a fixed rate still adds the tip', () => {
    expect(calculateWorkizCommission(input({ total: 300, tip: 20, rate: 100, rateUnit: '$' })).techProfit).toBe(120);
  });

  it('PTTWQL: rate 0 % leaves the technician the tip only', () => {
    const r = calculateWorkizCommission(
      input({ total: 3580.45, tax: 206.06, tip: 25, companyParts: 1056.93, paid: { cash: 0, credit: 3580.45, check: 0 }, rate: 0 }),
    );
    expect(r.techProfit).toBe(25);
    expect(r.companyProfit).toBe(2292.46);
  });

  it('each method carries its own fee', () => {
    const r = calculateWorkizCommission(
      input({
        total: 400,
        paid: { cash: 100, credit: 200, check: 100 },
        fees: { creditPct: 5, cashPct: 2, checkPct: 1 },
        rate: 50,
      }),
    );
    // fees = 10 + 2 + 1 = 13 → (400 − 13) × 0.5
    expect(r.fees).toBe(13);
    expect(r.techProfit).toBe(193.5);
  });

  it('billing is the unpaid remainder and an external profit comes off the company', () => {
    const r = calculateWorkizCommission(
      input({ total: 500, paid: { cash: 100, credit: 150, check: 50 }, rate: 0, externalCompanyProfit: 40 }),
    );
    expect(r.billing).toBe(200);
    expect(r.companyProfit).toBe(460);
  });
});

describe('workizBalance', () => {
  it('owes the technician profit + their parts, less the cash they kept', () => {
    expect(workizBalance({ techProfit: 48.63, parts: 82.74, cash: 0, cashByExternal: 0 })).toBe(131.37);
    expect(workizBalance({ techProfit: 100, parts: 0, cash: 300, cashByExternal: 0 })).toBe(-200);
  });

  it('cash the external company collected is not the technician’s to hand over', () => {
    expect(workizBalance({ techProfit: 165, parts: 0, cash: 210, cashByExternal: 210 })).toBe(165);
  });
});

describe('splitWorkizPayments', () => {
  const pay = (p: Record<string, unknown>) => ({ status: 'settled', refundedAmount: 0, amount: 0, method: 'card', ...p }) as never;

  it('puts card, offline card and installments in Credit, cash and check in their own', () => {
    const s = splitWorkizPayments([
      pay({ method: 'card', methodDetail: 'charge', amount: 100 }),
      pay({ method: 'card', amount: 50 }),
      pay({ method: 'other', methodDetail: 'installments', amount: 30 }),
      pay({ method: 'cash', amount: 20 }),
      pay({ method: 'check', amount: 10 }),
    ]);
    expect(s).toEqual({ cash: 20, credit: 180, check: 10, cashByExternal: 0, tip: 0 });
  });

  it('counts a payment net of refunds and with its tip (FZ9LNN, 6LKU66)', () => {
    expect(splitWorkizPayments([pay({ amount: 308.5, tipAmount: 59.56 })]).credit).toBe(368.06);
    expect(
      splitWorkizPayments([pay({ amount: 1834.53 }), pay({ amount: 2820.68, refundedAmount: 82.16 })]).credit,
    ).toBe(4573.05);
    expect(splitWorkizPayments([pay({ amount: 308.5, tipAmount: 59.56 })]).tip).toBe(59.56);
  });

  it('leaves bank transfers, Zelle and pending / failed / reversed payments out', () => {
    const s = splitWorkizPayments([
      pay({ method: 'bank', methodDetail: 'bank_transfer', amount: 100 }),
      pay({ method: 'other', methodDetail: 'zelle', amount: 100 }),
      pay({ method: 'card', status: 'pending', amount: 100 }),
      pay({ method: 'cash', status: 'failed', amount: 100 }),
      pay({ method: 'check', status: 'reversed', amount: 100 }),
    ]);
    expect(s).toEqual({ cash: 0, credit: 0, check: 0, cashByExternal: 0, tip: 0 });
  });

  it('marks charged cash as collected by the external company', () => {
    const s = splitWorkizPayments([pay({ method: 'cash', amount: 210, charged: true }), pay({ method: 'cash', amount: 5 })]);
    expect(s.cash).toBe(215);
    expect(s.cashByExternal).toBe(210);
  });
});

describe('configInForce', () => {
  const v30 = config({ baseRatePct: 30, effectiveDate: '2026-01-01T00:00:00.000Z' });
  const v35 = config({ baseRatePct: 35, effectiveDate: '2026-09-04T12:00:00.000Z' });

  it('takes the version in force on the job’s day — a raise does not reach back', () => {
    expect(configInForce([v35, v30], '2026-09-03')?.baseRatePct).toBe(30);
    expect(configInForce([v35, v30], '2026-09-04')?.baseRatePct).toBe(35);
  });

  it('falls back to the oldest version before the first, and the newest with no day', () => {
    expect(configInForce([v35, v30], '2025-06-01')?.baseRatePct).toBe(30);
    expect(configInForce([v30, v35], undefined)?.baseRatePct).toBe(35);
    expect(configInForce([], '2026-09-01')).toBeUndefined();
  });
});

describe('resolveWorkizRate', () => {
  const cfg = config({
    baseRatePct: 40,
    creditCardFeePct: 3,
    cashFeePct: 1,
    checkFeePct: 2,
    jobTypeRules: [{ jobTypeId: 'jt-safe', unit: '%', valuePercent: 45, valueDollars: 0 }],
  });

  it('the job’s own custom rate wins, in % or $', () => {
    expect(resolveWorkizRate({ useTechSpecialRate: true, techSpecialRate: 165, techSpecialRateUnit: '$' }, cfg)).toMatchObject({
      rate: 165,
      rateUnit: '$',
      rateSource: 'special',
    });
    expect(resolveWorkizRate({ useTechSpecialRate: true, techSpecialRate: 35 }, cfg)).toMatchObject({ rate: 35, rateUnit: '%' });
  });

  it('a custom rate that is switched off is ignored', () => {
    expect(resolveWorkizRate({ useTechSpecialRate: false, techSpecialRate: 35 }, cfg).rate).toBe(40);
  });

  it('then the technician’s rate for the job type, then the base rate', () => {
    expect(resolveWorkizRate({ jobTypeId: 'jt-safe' }, cfg)).toMatchObject({ rate: 45, rateSource: 'job_type' });
    expect(resolveWorkizRate({ jobTypeId: 'jt-other' }, cfg)).toMatchObject({ rate: 40, rateSource: 'tech', rateUnit: '%' });
    expect(resolveWorkizRate({}, config({ baseRatePct: 120, baseRateUnit: '$' }))).toMatchObject({ rate: 120, rateUnit: '$' });
  });

  it('fees come from the technician, missing ones are zero', () => {
    expect(resolveWorkizRate({}, cfg).fees).toEqual({ creditPct: 3, cashPct: 1, checkPct: 2 });
    expect(resolveWorkizRate({}, config({})).fees).toEqual({ creditPct: 3, cashPct: 0, checkPct: 0 });
  });

  it('no settings: rate 0, the job is the company’s', () => {
    expect(resolveWorkizRate({}, undefined)).toEqual({ rate: 0, rateUnit: '%', rateSource: 'none', fees: noFees });
  });
});

describe('round2', () => {
  it('rounds half away from zero', () => {
    expect(round2(48.625)).toBe(48.63);
    expect(round2(-2.005)).toBe(-2.01);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});
