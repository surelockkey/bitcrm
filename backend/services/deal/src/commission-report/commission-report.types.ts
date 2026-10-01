import type {
  CommissionRateUnit,
  CommissionReportBy,
  CommissionReportMode,
  CommissionReportRow,
  DealTotalsSnapshot,
  WorkizCommissionSnapshot,
} from '@bitcrm/types';

/**
 * A Done deal's METADATA row as the report reads it — raw, because several of
 * these attributes are written by the Workiz import and not (yet) part of the
 * `Deal` type the rest of the service maps rows into.
 */
export interface CommissionDealItem {
  id: string;
  dealNumber?: string | number;
  contactId?: string;
  invoiceId?: string;
  assignedTechIds?: string[];
  createdAt?: string;
  scheduledDate?: string;
  scheduledEndDate?: string;
  scheduledTimeSlot?: string;
  allDay?: boolean;
  jobTypeId?: string;
  address?: { street?: string; city?: string; state?: string; zip?: string };
  serviceArea?: string;
  serviceAreaId?: string;
  sourceId?: string;
  externalCompanyId?: string;
  superStatus?: string;
  status?: string;
  totals?: Partial<DealTotalsSnapshot> & { tip?: number };
  /** Workiz money the importer keeps on the job. */
  jobTotalPrice?: number;
  taxAmount?: number;
  tipAmount?: number;
  parts?: number;
  companyParts?: number;
  customFields?: Record<string, unknown>;
  /** Workiz "Custom Tech Rate" (Override Rates). */
  useTechSpecialRate?: boolean;
  techSpecialRate?: number;
  techSpecialRateUnit?: CommissionRateUnit;
  jobTimezone?: string;
  /** Workiz's own report row for this job, frozen at import. */
  commissionSnapshot?: WorkizCommissionSnapshot;
  clientName?: { firstName?: string; lastName?: string };
  clientCompanyName?: string;
}

export interface CommissionReportQuery {
  from: string;
  to: string;
  by: CommissionReportBy;
  mode: CommissionReportMode;
  techId?: string;
  jobTypeId?: string;
  serviceAreaId?: string;
  /** A company id, or `only` for "External Only" (any company). */
  externalCompanyId?: string;
  /** Workiz "Ad Group" — the job source. */
  sourceId?: string;
  q?: string;
  sort?: CommissionReportSortKey;
  dir?: 'asc' | 'desc';
  offset: number;
  limit: number;
}

export const COMMISSION_REPORT_SORT_KEYS = [
  'dealNumber',
  'techName',
  'createdAt',
  'scheduledDate',
  'closedDate',
  'jobTypeName',
  'address',
  'total',
  'cash',
  'credit',
  'billing',
  'check',
  'rate',
  'tip',
  'parts',
  'companyParts',
  'techProfit',
  'externalCompanyProfit',
  'companyProfit',
  'tax',
  'balance',
  'clientName',
] as const;
export type CommissionReportSortKey = (typeof COMMISSION_REPORT_SORT_KEYS)[number];

/** A built row before the page's client names are looked up. */
export type BuiltRow = CommissionReportRow;
