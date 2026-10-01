import {
  ESTIMATE_STATUSES,
  ESTIMATE_STATUS_LABELS,
  estimateReportAmount,
  type Estimate,
  type EstimateReportSummary,
  type EstimateStatus,
} from '@bitcrm/types';
import { businessDay } from '../../payments/report/payment-report.rules';
import { BILLING_REPORT_TZ, csvRow, type InstantWindow } from '../../invoices/report/invoice-report.rules';

/**
 * Pure rules of Workiz's Estimates page (`/root/estimates`): the six status
 * cards ("N Worth $X") for a created-date window, the search, the CSV.
 */

export interface EstimateReportFilter extends InstantWindow {
  status?: EstimateStatus;
  search?: string;
}

/** The fields the cards need — all a summary read projects. */
export type EstimateCardRow = Pick<Estimate, 'status' | 'totals' | 'workizTotal' | 'dealId'>;

/** The six cards and their sum, amounts added in cents (Workiz Amount — `estimateReportAmount`). */
export function estimateCards(rows: EstimateCardRow[]): Omit<EstimateReportSummary, 'from' | 'to'> {
  const cents = Object.fromEntries([...ESTIMATE_STATUSES, 'total'].map((s) => [s, { count: 0, amount: 0 }])) as Record<
    EstimateStatus | 'total',
    { count: number; amount: number }
  >;
  for (const e of rows) {
    const c = Math.round(estimateReportAmount(e) * 100);
    const bucket = cents[e.status as EstimateStatus];
    if (bucket) {
      bucket.count++;
      bucket.amount += c;
    }
    cents.total.count++;
    cents.total.amount += c;
  }
  const out = {} as Omit<EstimateReportSummary, 'from' | 'to'>;
  for (const [k, v] of Object.entries(cents)) {
    (out as Record<string, { count: number; amount: number }>)[k] = { count: v.count, amount: v.amount / 100 };
  }
  return out;
}

export function normalizeEstimateSearch(raw: string | undefined): string | undefined {
  const s = raw?.trim().toLowerCase();
  return s ? s : undefined;
}

/** Workiz's Estimates CSV: not the table's columns — Email and Created By in, Source and Deposit out. */
export const ESTIMATE_CSV_HEADERS = [
  'Estimate #',
  'Estimate Name',
  'Client',
  'Email',
  'Created',
  'Created By',
  'Amount',
  'Status',
  'Job',
] as const;

export function estimateCsvLine(
  e: Estimate,
  client: { name?: string; email?: string } | undefined,
  createdBy: string | undefined,
  tz: string = BILLING_REPORT_TZ,
): string {
  return csvRow([
    e.number,
    e.name ?? '',
    client?.name ?? '',
    client?.email ?? '',
    e.createdAt ? businessDay(e.createdAt, tz) : '',
    createdBy ?? '',
    estimateReportAmount(e).toFixed(2),
    ESTIMATE_STATUS_LABELS[e.status] ?? e.status,
    // Workiz's Job column is the job's code — ours is the deal number.
    e.dealNumber ?? '',
  ]);
}
