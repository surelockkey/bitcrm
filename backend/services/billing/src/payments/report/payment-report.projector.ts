import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Payment } from '@bitcrm/types';
import { DealClient } from '../../integrations/deal.client';
import {
  PaymentReportRepository,
  ReportProjectionConflictError,
  pointerFor,
  type PointerLine,
} from './payment-report.repository';
import {
  PAYMENT_REPORT_TZ,
  bucketDelta,
  bucketOf,
  contributionOf,
  dealDims,
  isUnconfirmedCheckout,
  reportLines,
  type LineDims,
} from './payment-report.rules';

const MAX_ATTEMPTS = 5;

/**
 * Keeps the Payments report in step with the ledger. It never applies a
 * delta it was told about: it re-reads the payment (strongly consistent),
 * works out the lines it should have, compares them with the lines it had
 * (its `REPORT` pointer) and writes the difference — lines and bucket
 * counters — in one transaction guarded by the pointer's revision. A lost
 * race is simply re-run, so concurrent writers converge on the ledger's
 * final state.
 *
 * Best effort by design: `project` never throws. A payment has already been
 * taken when it runs; a report that lags is fixed by the next write to the
 * same payment or by `npm run rebuild:payment-report`.
 */
@Injectable()
export class PaymentReportProjector {
  private readonly logger = new Logger(PaymentReportProjector.name);
  /** Months "All time" is known to cover, so the index is not rewritten on every payment. */
  private readonly knownMonths = new Set<string>();
  private readonly tz = PAYMENT_REPORT_TZ;

  constructor(
    private readonly repo: PaymentReportRepository,
    @Optional() private readonly deal?: DealClient,
  ) {}

  async project(paymentId: string): Promise<void> {
    try {
      await this.projectOrThrow(paymentId);
    } catch (err) {
      this.logger.error(`payments report: payment ${paymentId} not projected: ${(err as Error).message}`);
    }
  }

  /** The same, surfacing failures — for the tests and the rebuild script. */
  async projectOrThrow(paymentId: string): Promise<void> {
    let dims: LineDims | undefined;
    for (let attempt = 1; ; attempt++) {
      const { payment, refunds, pointer } = await this.repo.readPaymentPartition(paymentId);
      if (!pointer && (!payment || isUnconfirmedCheckout(payment))) return;
      if (payment && dims === undefined) dims = await this.dimsFor(payment);
      const lines = payment ? reportLines(payment, refunds, dims ?? {}, this.tz) : [];
      // Never in the report and not now either (an open portal checkout).
      if (!pointer && lines.length === 0) return;
      const next = lines.map((line) => {
        const key = `${line.day}#${bucketOf(line)}`;
        return { line, pointer: pointerFor(line, key, contributionOf(line)) };
      });
      const deltas = bucketDelta(
        (pointer?.lines ?? []).map((l: PointerLine) => ({ key: l.key, c: l })),
        next.map((n) => ({ key: n.pointer.key, c: n.pointer })),
      );
      try {
        await this.repo.commit(paymentId, pointer, next, deltas);
        await this.widen(next.map((n) => n.line.day.slice(0, 7)));
        return;
      } catch (err) {
        if (!(err instanceof ReportProjectionConflictError) || attempt >= MAX_ATTEMPTS) throw err;
        await new Promise((r) => setTimeout(r, 20 * attempt + Math.floor(Math.random() * 30)));
      }
    }
  }

  /**
   * The job's lead technician, service area and number, for a payment that
   * does not carry them itself (one taken in the portal, say). A deal-service
   * outage leaves them empty — the line still counts, just unfiltered by them.
   */
  private async dimsFor(p: Payment): Promise<LineDims> {
    if (!this.deal) return {};
    const view = await this.deal.getBillingView(p.dealId).catch(() => null);
    const deal = view?.deal;
    return deal ? dealDims(deal) : {};
  }

  private async widen(months: string[]): Promise<void> {
    for (const m of new Set(months)) {
      if (this.knownMonths.has(m)) continue;
      await this.repo.widenIndex(m);
      this.knownMonths.add(m);
    }
  }
}
