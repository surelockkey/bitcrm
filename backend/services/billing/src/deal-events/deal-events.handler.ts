import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { BusinessMetricsService, SqsConsumerService } from '@bitcrm/shared';
import { JobSuperStatus } from '@bitcrm/types';
import { EstimatesService } from '../estimates/estimates.service';
import { InvoicesService } from '../invoices/invoices.service';

/** deal-events types consumed from the `billing-deal-events` queue. */
export const DEAL_EVENT_TYPES = [
  'deal.product_added',
  'deal.product_updated',
  'deal.product_removed',
  'deal.products_replaced',
  'deal.updated',
  'deal.status_changed',
  'deal.deleted',
] as const;

const REFRESH = new Set<string>([
  'deal.product_added',
  'deal.product_updated',
  'deal.product_removed',
  'deal.products_replaced',
  'deal.updated',
]);

interface DealEventPayload {
  dealId?: string;
  newStatus?: string;
  [key: string]: unknown;
}

/**
 * Keeps billing in step with jobs:
 * - line / tax / discount / payment changes → refresh the invoice snapshot;
 * - job moved to another client (deal.updated) → the invoice and estimates follow;
 * - job canceled → archive its open estimates;
 * - job deleted → delete its invoice and estimates.
 * Handlers are idempotent (the consumer does not deduplicate) and rethrow so
 * SQS retries and, after 5 receives, dead-letters.
 */
@Injectable()
export class DealEventsHandler implements OnModuleInit {
  private readonly logger = new Logger(DealEventsHandler.name);

  constructor(
    private readonly invoices: InvoicesService,
    private readonly estimates: EstimatesService,
    @Optional() private readonly consumer?: SqsConsumerService,
    @Optional() private readonly metrics?: BusinessMetricsService,
  ) {}

  onModuleInit(): void {
    if (!this.consumer || !process.env.BILLING_DEAL_EVENTS_QUEUE_URL) return;
    for (const type of DEAL_EVENT_TYPES) {
      this.consumer.registerHandler(type, (payload) => this.handle(type, payload as DealEventPayload));
    }
  }

  async handle(type: string, payload: DealEventPayload): Promise<void> {
    const dealId = payload?.dealId;
    if (!dealId) return;
    const done = this.metrics?.sqsProcessingDuration.startTimer({ event_type: type });
    try {
      if (REFRESH.has(type)) {
        await this.invoices.refreshFromDeal(dealId);
        // A client change is published as deal.updated; estimates follow the job.
        if (type === 'deal.updated') await this.estimates.followDealContact(dealId);
      } else if (type === 'deal.status_changed') {
        if (payload.newStatus === JobSuperStatus.CANCELED) {
          const n = await this.estimates.archiveOpenForDeal(dealId);
          if (n) this.logger.log(`job ${dealId} canceled: archived ${n} estimate(s)`);
        }
        await this.invoices.refreshFromDeal(dealId);
      } else if (type === 'deal.deleted') {
        await this.invoices.deleteForDeal(dealId);
        await this.estimates.deleteForDeal(dealId);
      }
      this.metrics?.sqsMessagesProcessed.inc({ event_type: type, status: 'success' });
    } catch (err) {
      this.metrics?.sqsMessagesProcessed.inc({ event_type: type, status: 'error' });
      throw err;
    } finally {
      done?.();
    }
  }
}
