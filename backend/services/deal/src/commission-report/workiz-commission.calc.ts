import {
  COUNTED_PAYMENT_STATUSES,
  type CommissionConfig,
  type CommissionRateSource,
  type CommissionRateUnit,
  type Payment,
} from '@bitcrm/types';

/**
 * The Workiz "Commissions (Legacy)" formula, as verified on every row of the
 * live report (2026-09-01..27, 1 073 jobs):
 *
 *   fees           = credit × creditFee% + cash × cashFee% + check × checkFee%
 *   tech profit    = (total − tax − tip − parts − companyParts − fees) × rate% + tip
 *                    or, for a fixed rate, rate$ + tip
 *   company profit = total − tax − techProfit − parts − companyParts − externalProfit
 *   billing        = total − cash − credit − check
 *   balance        = techProfit + parts − (cash − cashByExternal)
 *
 * The fee comes off BEFORE the split and is itself split by the rate, every
 * payment method has its own fee, the tip goes to the technician whole, and a
 * rate can be a fixed dollar amount. That is why this is a separate function
 * and not `calculateCommission` in user-service, which computes the EPIC-6
 * payout (fee after the rate, one card flag, no tip, no company parts) and
 * stays exactly as it is.
 */

export interface WorkizPaid {
  cash: number;
  /** Card charges, offline card and installments. */
  credit: number;
  check: number;
}

export interface WorkizFees {
  creditPct: number;
  cashPct: number;
  checkPct: number;
}

export interface WorkizCommissionInput {
  total: number;
  tax: number;
  tip: number;
  /** Parts the technician bought. */
  parts: number;
  companyParts: number;
  paid: WorkizPaid;
  fees: WorkizFees;
  rate: number;
  rateUnit: CommissionRateUnit;
  externalCompanyProfit?: number;
}

export interface WorkizCommissionResult {
  fees: number;
  techProfit: number;
  companyProfit: number;
  billing: number;
}

/** Half away from zero, to the cent — the way Workiz prints its figures. */
export function round2(n: number): number {
  const sign = n < 0 ? -1 : 1;
  return (sign * Math.round((Math.abs(n) + Number.EPSILON) * 100)) / 100;
}

export function calculateWorkizCommission(input: WorkizCommissionInput): WorkizCommissionResult {
  const fees =
    (input.paid.credit * input.fees.creditPct) / 100 +
    (input.paid.cash * input.fees.cashPct) / 100 +
    (input.paid.check * input.fees.checkPct) / 100;
  const techProfit = round2(
    input.rateUnit === '$'
      ? input.rate + input.tip
      : ((input.total - input.tax - input.tip - input.parts - input.companyParts - fees) * input.rate) / 100 + input.tip,
  );
  const companyProfit = round2(
    input.total - input.tax - techProfit - input.parts - input.companyParts - (input.externalCompanyProfit ?? 0),
  );
  const billing = round2(input.total - input.paid.cash - input.paid.credit - input.paid.check);
  return { fees: round2(fees), techProfit, companyProfit, billing };
}

/** What the company owes the technician on a job; below zero the technician holds company cash. */
export function workizBalance(row: { techProfit: number; parts: number; cash: number; cashByExternal: number }): number {
  return round2(row.techProfit + row.parts - (row.cash - row.cashByExternal));
}

/** Imported Workiz payment kinds that land in the Credit column. */
const CREDIT_DETAILS: ReadonlySet<string> = new Set(['charge', 'credit', 'installments']);

/** A ledger row with the attributes the Workiz import adds on top of `Payment`. */
export type LedgerPayment = Pick<Payment, 'method' | 'status' | 'amount' | 'refundedAmount' | 'tipAmount'> & {
  /** Workiz's own payment kind: charge, credit, installments, cash, check, zelle, … */
  methodDetail?: string;
  /** Workiz `charged`: a cash payment the external company collected. */
  charged?: boolean;
  tipRefundedAmount?: number;
};

export interface WorkizPaymentSplit extends WorkizPaid {
  cashByExternal: number;
  /** Σ tips on the counted payments. */
  tip: number;
}

/**
 * A job's ledger in Workiz's columns. A column holds what was collected: the
 * payment net of its refunds, WITH its tip (Workiz's Credit of a $308.50 card
 * payment with a $59.56 tip is $368.06). Card, offline card and installments
 * are Credit; bank transfers, Zelle and other methods sit in no column, so
 * they stay in Billing (the open remainder) — as they do in Workiz. Pending,
 * failed and reversed payments count nowhere.
 */
export function splitWorkizPayments(payments: LedgerPayment[]): WorkizPaymentSplit {
  let cash = 0;
  let credit = 0;
  let check = 0;
  let cashByExternal = 0;
  let tip = 0;
  for (const p of payments) {
    if (!COUNTED_PAYMENT_STATUSES.includes(p.status)) continue;
    const tipNet = (p.tipAmount ?? 0) - (p.tipRefundedAmount ?? 0);
    const collected = (p.amount ?? 0) - (p.refundedAmount ?? 0) + tipNet;
    tip += tipNet;
    if (p.method === 'cash') {
      cash += collected;
      if (p.charged) cashByExternal += collected;
    } else if (p.method === 'check') {
      check += collected;
    } else if (p.method === 'card' || (p.methodDetail && CREDIT_DETAILS.has(p.methodDetail))) {
      credit += collected;
    }
  }
  return {
    cash: round2(cash),
    credit: round2(credit),
    check: round2(check),
    cashByExternal: round2(cashByExternal),
    tip: round2(tip),
  };
}

export interface WorkizRate {
  rate: number;
  rateUnit: CommissionRateUnit;
  rateSource: CommissionRateSource;
  fees: WorkizFees;
}

/**
 * The technician's commission version in force on a day: the newest one
 * whose `effectiveDate` is on or before it, else the oldest one there is.
 * Versions are never rewritten (a change writes a new one), so a job keeps
 * the rate of the day it closed — Workiz freezes the rate on the job too.
 */
export function configInForce(history: CommissionConfig[], day: string | undefined): CommissionConfig | undefined {
  if (!history.length) return undefined;
  const sorted = [...history].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  if (!day) return sorted[sorted.length - 1];
  let pick: CommissionConfig | undefined;
  for (const c of sorted) if (c.effectiveDate.slice(0, 10) <= day) pick = c;
  return pick ?? sorted[0];
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

/**
 * Which rate a job pays, in Workiz's order: the job's own "Custom Tech Rate"
 * (Override Rates) → the technician's rate for the job's type → their base
 * rate. Fees always come from the technician's settings. No technician or no
 * settings: rate 0, the job is all company.
 */
export function resolveWorkizRate(
  job: { useTechSpecialRate?: boolean; techSpecialRate?: number; techSpecialRateUnit?: CommissionRateUnit; jobTypeId?: string },
  config: CommissionConfig | undefined,
): WorkizRate {
  const fees: WorkizFees = {
    creditPct: num(config?.creditCardFeePct),
    cashPct: num(config?.cashFeePct),
    checkPct: num(config?.checkFeePct),
  };
  if (job.useTechSpecialRate && job.techSpecialRate !== undefined && job.techSpecialRate !== null) {
    return { rate: num(job.techSpecialRate), rateUnit: job.techSpecialRateUnit === '$' ? '$' : '%', rateSource: 'special', fees };
  }
  if (!config) return { rate: 0, rateUnit: '%', rateSource: 'none', fees };
  const rule = job.jobTypeId ? config.jobTypeRules?.find((r) => r.jobTypeId === job.jobTypeId) : undefined;
  if (rule) {
    const dollars = rule.unit === '$';
    return {
      rate: num(dollars ? rule.valueDollars : rule.valuePercent),
      rateUnit: dollars ? '$' : '%',
      rateSource: 'job_type',
      fees,
    };
  }
  return { rate: num(config.baseRatePct), rateUnit: config.baseRateUnit === '$' ? '$' : '%', rateSource: 'tech', fees };
}
