import { type CommissionBreakdown } from '@bitcrm/types';

export interface CommissionRates {
  baseRatePct: number;
  creditCardFeePct: number;
  achFeePct: number;
}

export interface DealInputs {
  revenue: number;
  tax: number;
  partsCost: number;
  paidByCard: boolean;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Commission payout per EPIC-6:
 *   baseProfit = revenue - tax - partsCost
 *   techShare  = baseProfit * baseRate%
 *   deduction  = dealTotal(=revenue) * (card ? ccFee% : achFee%)
 *   netPayout  = techShare - deduction
 */
export function calculateCommission(
  rates: CommissionRates,
  deal: DealInputs,
): CommissionBreakdown {
  const baseProfit = round2(deal.revenue - deal.tax - deal.partsCost);
  const techShare = round2((baseProfit * rates.baseRatePct) / 100);
  const feePct = deal.paidByCard ? rates.creditCardFeePct : rates.achFeePct;
  const deduction = round2((deal.revenue * feePct) / 100);
  const netPayout = round2(techShare - deduction);
  return { baseProfit, techShare, deduction, netPayout };
}
