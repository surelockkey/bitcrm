import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { BusinessMetricsService, SqsConsumerService } from '@bitcrm/shared';
import { CallsService } from './calls.service';

/**
 * deal-events consumed from telephony's queue (`deal-events-to-telephony`) —
 * the ones that can move a job's total, the same set billing refreshes an
 * invoice on. `deal.deleted` included: deal-service then knows no total, and
 * the calls are stamped 0 — what the reports always counted a gone job as.
 */
export const CALL_DEAL_EVENT_TYPES = [
  'deal.product_added',
  'deal.product_updated',
  'deal.product_removed',
  'deal.products_replaced',
  'deal.updated',
  'deal.status_changed',
  'deal.deleted',
] as const;

/**
 * Keeps `dealTotal` on linked calls fresh. The payload is not trusted for the
 * figure (none of these events carries one): the job's total is re-read from
 * deal-service (`POST /deals/internal/deal-totals`) for that one job.
 * Idempotent (the write is conditional on the total having changed) and
 * rethrows so SQS retries and, after 5 receives, dead-letters.
 */
@Injectable()
export class CallDealEventsHandler implements OnModuleInit {
  private readonly logger = new Logger(CallDealEventsHandler.name);

  constructor(
    private readonly calls: CallsService,
    @Optional() private readonly consumer?: SqsConsumerService,
    @Optional() private readonly metrics?: BusinessMetricsService,
  ) {}

  onModuleInit(): void {
    if (!this.consumer || !process.env.DEAL_EVENTS_TO_TELEPHONY_QUEUE_URL) return;
    for (const type of CALL_DEAL_EVENT_TYPES) {
      this.consumer.registerHandler(type, (payload) => this.handle(type, payload as { dealId?: string }));
    }
  }

  async handle(type: string, payload: { dealId?: string }): Promise<void> {
    const dealId = payload?.dealId;
    if (!dealId) return;
    const done = this.metrics?.sqsProcessingDuration.startTimer({ event_type: type });
    try {
      const calls = await this.calls.refreshDealTotals(dealId);
      if (calls) this.logger.debug?.(`${type} ${dealId}: ${calls} call(s) restamped`);
      this.metrics?.sqsMessagesProcessed.inc({ event_type: type, status: 'success' });
    } catch (err) {
      this.metrics?.sqsMessagesProcessed.inc({ event_type: type, status: 'error' });
      throw err;
    } finally {
      done?.();
    }
  }
}
