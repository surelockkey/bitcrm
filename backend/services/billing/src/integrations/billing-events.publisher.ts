import { Injectable, Logger, Optional } from '@nestjs/common';
import { BusinessMetricsService, SnsPublisherService } from '@bitcrm/shared';
import {
  BILLING_EVENT_TOPIC,
  BillingEventType,
  type Estimate,
  type EstimateEvent,
  type Invoice,
  type InvoiceEvent,
} from '@bitcrm/types';

/**
 * Fire-and-forget `billing-events` publishing. Gated on
 * BILLING_EVENTS_TOPIC_ARN (the publisher throws for an unconfigured topic,
 * which is swallowed here — a publish must never fail a write).
 */
@Injectable()
export class BillingEventsPublisher {
  private readonly logger = new Logger(BillingEventsPublisher.name);

  constructor(
    @Optional() private readonly sns?: SnsPublisherService,
    @Optional() private readonly metrics?: BusinessMetricsService,
  ) {}

  invoice(type: BillingEventType, invoice: Invoice): void {
    const payload: InvoiceEvent = {
      invoiceId: invoice.id,
      dealId: invoice.dealId,
      contactId: invoice.contactId,
      number: invoice.number,
      status: invoice.status,
      total: invoice.totals?.total ?? 0,
    };
    this.publish(type, payload);
  }

  estimate(type: BillingEventType, estimate: Estimate): void {
    const payload: EstimateEvent = {
      estimateId: estimate.id,
      dealId: estimate.dealId,
      contactId: estimate.contactId,
      number: estimate.number,
      status: estimate.status,
      total: estimate.totals?.total ?? 0,
    };
    this.publish(type, payload);
  }

  private publish(type: BillingEventType, payload: unknown): void {
    if (!this.sns || !process.env.BILLING_EVENTS_TOPIC_ARN) return;
    this.sns
      .publish(BILLING_EVENT_TOPIC, type, payload)
      .then(() => this.metrics?.eventsPublished.inc({ event_type: type }))
      .catch((err: Error) => {
        this.metrics?.eventsFailed.inc({ event_type: type });
        this.logger.warn(`publish ${type} failed: ${err.message}`);
      });
  }
}
