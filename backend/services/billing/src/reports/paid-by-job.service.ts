import { Injectable } from '@nestjs/common';
import { PaymentReportRepository } from '../payments/report/payment-report.repository';
import { PAYMENT_REPORT_TZ, addDays, dayStartUtc, monthsBetween } from '../payments/report/payment-report.rules';
import { paidByJob, type PaidByJob } from './paid-by-job.rules';

/** A window this long covers "This year" and a 12-month Custom range, with room. */
const MAX_MONTHS = 25;

/**
 * Per-job collections in a window of business days, off the Payments
 * report's own lines (`PAYLINE#<YYYY-MM>`, keyed by the PAYMENT date — never
 * the ledger's `createdAt`, which a back-dated cheque does not share). Read
 * side of PR #83's projection; nothing here writes it.
 */
@Injectable()
export class PaidByJobService {
  constructor(private readonly lines: PaymentReportRepository) {}

  async window(from: string, to: string): Promise<PaidByJob[]> {
    const months = monthsBetween(from.slice(0, 7), to.slice(0, 7)).slice(0, MAX_MONTHS);
    const { lines } = await this.lines.walkLines({
      cursor: { ms: months },
      fromIso: dayStartUtc(from, PAYMENT_REPORT_TZ),
      toIso: dayStartUtc(addDays(to, 1), PAYMENT_REPORT_TZ),
      dir: 'asc',
      filter: { types: [], technicianIds: [], serviceAreaIds: [] },
      want: Number.MAX_SAFE_INTEGER,
      maxRounds: 10_000,
    });
    return paidByJob(lines);
  }
}
