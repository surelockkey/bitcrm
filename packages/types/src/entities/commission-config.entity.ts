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

  /*
   * Workiz "Technician Fees" and rate rules, written by the Workiz import and
   * read by the Commissions report. Optional: a version saved from BitCRM's
   * own form has none of them, and then they count as zero / `%`.
   */
  /** % of the check payments taken off before the split (Workiz CHECK FEE). */
  checkFeePct?: number;
  /** % of the cash payments taken off before the split (Workiz CASH FEE). */
  cashFeePct?: number;
  /** Workiz ADDITIONAL FEE — carried, not applied (0 for every SLK technician). */
  additionalFee?: { value: number; unit: '%' | '$'; deductFromTotal: boolean };
  /** `$` makes `baseRatePct` a fixed payout per job instead of a percentage. */
  baseRateUnit?: '%' | '$';
  /** Workiz "Rates By Job Type": a job of that type pays this rate instead of the base one. */
  jobTypeRules?: CommissionJobTypeRule[];
}

/** One Workiz "Rates By Job Type" line. */
export interface CommissionJobTypeRule {
  jobTypeId: string;
  unit: '%' | '$';
  valuePercent?: number;
  valueDollars?: number;
}

/** Inputs + result of a payout computation (not persisted). */
export interface CommissionBreakdown {
  baseProfit: number;
  techShare: number;
  deduction: number;
  netPayout: number;
}
