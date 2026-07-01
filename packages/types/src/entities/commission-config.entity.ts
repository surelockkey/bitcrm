/**
 * Per-technician commission configuration. Versioned: each change writes a new
 * item (SK=COMMISSION#<effectiveDateISO>) so historical rates are preserved for
 * accurate retroactive reporting. The latest version is the highest SK.
 */
export interface CommissionConfig {
  userId: string;
  /** % of profit-after-parts-and-fees paid to the technician (e.g. 40). */
  baseRatePct: number;
  /** % of deal total deducted when paid by credit card (default 3). */
  creditCardFeePct: number;
  /** % of deal total deducted when paid by ACH (default 0). */
  achFeePct: number;
  effectiveDate: string;
  createdBy: string;
  createdAt: string;
}

/** Inputs + result of a payout computation (not persisted). */
export interface CommissionBreakdown {
  baseProfit: number;
  techShare: number;
  deduction: number;
  netPayout: number;
}
