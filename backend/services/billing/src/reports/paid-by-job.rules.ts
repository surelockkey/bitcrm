import type { ReportLine } from '../payments/report/payment-report.rules';

/** One job's collections in a window — what the Tax report's Paid tab needs. */
export interface PaidByJob {
  dealId: string;
  /** Collected in the window, tips left out, refunds and reversals netted: Σ (amount − tip). */
  paid: number;
}

/**
 * Sums the Payments report's lines per job. The lines ARE Workiz's payment
 * dates (a refund on its own date, negative), so "paid in the period" here is
 * exactly what the Payments report lists for the period. A tip is not a sale
 * — it is taken out; a line still in transit (`pending`) or `failed` has not
 * collected anything yet.
 */
export function paidByJob(lines: Iterable<Pick<ReportLine, 'dealId' | 'amount' | 'tip' | 'status'>>): PaidByJob[] {
  const cents = new Map<string, number>();
  for (const l of lines) {
    if (!l.dealId || l.status === 'pending' || l.status === 'failed') continue;
    const c = Math.round((l.amount || 0) * 100) - Math.round((l.tip || 0) * 100);
    cents.set(l.dealId, (cents.get(l.dealId) ?? 0) + c);
  }
  return [...cents].map(([dealId, c]) => ({ dealId, paid: c / 100 }));
}
