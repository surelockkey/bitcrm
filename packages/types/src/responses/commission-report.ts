/**
 * Workiz "Commissions (Legacy)" — the Finance Reporting page: what every Done
 * job took in and how it splits between the technician, the company and an
 * external (referral) company. `GET /api/deals/reports/commissions`.
 *
 * Money is dollars, 2dp, exactly as Workiz shows it. A rate is a RATE, not an
 * amount: `50` with unit `%`, or `165` with unit `$` (a fixed payout).
 */

/** Standard (all jobs) · Tech (one technician, with a running balance) · External company. */
export const COMMISSION_REPORT_MODES = ['standard', 'tech', 'external'] as const;
export type CommissionReportMode = (typeof COMMISSION_REPORT_MODES)[number];

/**
 * Which date the period applies to. Workiz's "Closed" is the END OF THE
 * VISIT WINDOW (`scheduledEndDate`), not the moment the job turned Done.
 */
export const COMMISSION_REPORT_BY = ['closed', 'scheduled', 'created'] as const;
export type CommissionReportBy = (typeof COMMISSION_REPORT_BY)[number];

export type CommissionRateUnit = '%' | '$';

/** Where a row's numbers came from: Workiz's own report (imported) or the Workiz formula here. */
export type CommissionRowSource = 'workiz' | 'computed';

/** The rate a job was paid at, and whose rule it was. */
export type CommissionRateSource = 'tech' | 'special' | 'job_type' | 'none';

/**
 * The frozen Workiz report row the importer puts on a Done job
 * (`Deal.commissionSnapshot`). Read as-is: Workiz froze the rate on the job,
 * and the technician's settings today may differ.
 */
export interface WorkizCommissionSnapshot {
  source: 'workiz_commissions_report';
  capturedAt: string;
  techId: string;
  workizTechId?: string;
  rate?: number;
  rateUnit?: CommissionRateUnit;
  rateSource?: 'tech' | 'special';
  total: number;
  tax: number;
  tip: number;
  parts: number;
  companyParts: number;
  techProfit: number;
  companyProfit: number;
  externalCompanyProfit: number;
  paid: { cash: number; credit: number; check: number };
  billing: number;
  cashByExternal: number;
  /** The visit window's end in the job's local time, `YYYY-MM-DDTHH:MM`. */
  closedLocal: string;
}

export interface CommissionReportRow {
  dealId: string;
  /** Job ID (the 6-char code, or a legacy number). */
  dealNumber: string;
  invoiceId?: string;
  /** The job's primary technician — a job shared by several is theirs (Workiz). */
  techId?: string;
  techName?: string;
  /** Every technician on the job, primary first. */
  techIds: string[];
  createdAt: string;
  scheduledDate?: string;
  scheduledTimeSlot?: string;
  /** End of the visit window — the report's "Closed" (YYYY-MM-DD). */
  closedDate?: string;
  /** `HH:MM` the window ends, when the job has times. */
  closedTime?: string;
  jobTypeId?: string;
  jobTypeName?: string;
  address: string;
  serviceAreaId?: string;
  serviceArea?: string;
  contactId?: string;
  clientName?: string;
  externalCompanyId?: string;
  externalCompanyName?: string;
  /** Workiz "Ad Group" = the job source. */
  sourceId?: string;
  sourceName?: string;
  total: number;
  cash: number;
  /** Card charges, offline card and installments. */
  credit: number;
  /** What is still open: total − cash − credit − check. */
  billing: number;
  check: number;
  /** The technician's rate on this job ("Tech Share"). */
  rate?: number;
  rateUnit?: CommissionRateUnit;
  rateSource: CommissionRateSource;
  tip: number;
  /** Parts the technician bought ("Tech Parts cost"). */
  parts: number;
  companyParts: number;
  /** Card / cash / check fees taken off before the split. */
  fees: number;
  techProfit: number;
  externalCompanyProfit: number;
  companyProfit: number;
  tax: number;
  cashByExternal: number;
  creditByExternal: number;
  billingByExternal: number;
  checkByExternal: number;
  /** What the company owes the technician on this job (< 0: the technician owes). */
  balance: number;
  source: CommissionRowSource;
}

/** A column's sum and how many rows hold a non-zero value in it (Workiz's "(N Jobs)"). */
export interface CommissionReportTotal {
  amount: number;
  jobs: number;
}

export const COMMISSION_REPORT_TOTAL_KEYS = [
  'total',
  'cash',
  'credit',
  'billing',
  'check',
  'tip',
  'parts',
  'companyParts',
  'fees',
  'techProfit',
  'externalCompanyProfit',
  'companyProfit',
  'tax',
  'cashByExternal',
  'creditByExternal',
  'billingByExternal',
  'checkByExternal',
  'balance',
] as const;
export type CommissionReportTotalKey = (typeof COMMISSION_REPORT_TOTAL_KEYS)[number];

export type CommissionReportTotals = Record<CommissionReportTotalKey, CommissionReportTotal>;

/** One technician's slice of the period (the "[N]" next to a name, and the Send Bulk list). */
export interface CommissionReportTechSummary {
  techId: string;
  techName?: string;
  jobs: number;
  total: number;
  techProfit: number;
  parts: number;
  companyParts: number;
  tip: number;
  tax: number;
  balance: number;
}

export interface CommissionReportExternalSummary {
  externalCompanyId: string;
  externalCompanyName?: string;
  jobs: number;
  total: number;
  profit: number;
}

export interface CommissionReport {
  window: { by: CommissionReportBy; from: string; to: string };
  mode: CommissionReportMode;
  /** Rows after the filters and the search — what "Totals:<N>" counts. */
  count: number;
  offset: number;
  limit: number;
  /** One page of rows, in the requested order. */
  rows: CommissionReportRow[];
  /** Over every row of the filtered set, not just the page. */
  totals: CommissionReportTotals;
  /** Per technician over the period and every filter except the technician. */
  techs: CommissionReportTechSummary[];
  /** Per external company over the period and every filter except the company. */
  externalCompanies: CommissionReportExternalSummary[];
  /** Rows computed here (jobs done in BitCRM) rather than taken from Workiz's own report. */
  computedRows: number;
}
