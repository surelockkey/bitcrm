import { type CommissionConfig } from '@bitcrm/types';

/** EPIC-6 default commission applied to technicians that have no config yet. */
export const DEFAULT_COMMISSION = {
  baseRatePct: 40,
  creditCardFeePct: 3,
  achFeePct: 0,
} as const;

export function buildDefaultCommission(
  userId: string,
  createdBy: string,
  now: string,
): CommissionConfig {
  return {
    userId,
    baseRatePct: DEFAULT_COMMISSION.baseRatePct,
    creditCardFeePct: DEFAULT_COMMISSION.creditCardFeePct,
    achFeePct: DEFAULT_COMMISSION.achFeePct,
    effectiveDate: now,
    createdBy,
    createdAt: now,
  };
}
