import { Injectable, Logger, Optional } from '@nestjs/common';
import { BusinessMetricsService } from '@bitcrm/shared';
import { DealsService } from './deals.service';

/**
 * Deal-service's SQS handlers. There is deliberately no `payment.received`
 * handler: the payment ledger lives in billing-service, which pushes the job's
 * denormalised flag straight to `PUT /internal/:id/payment-status` rather than
 * through a queue (no queue ever carried that event, and nothing published it).
 */
@Injectable()
export class DealsEventHandler {
  private readonly logger = new Logger(DealsEventHandler.name);

  constructor(
    private readonly dealsService: DealsService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {}

  async handleContactMerged(payload: any): Promise<void> {
    const timer = this.businessMetrics?.sqsProcessingDuration.startTimer({ event_type: 'contact.merged' });
    try {
      const count = await this.dealsService.reassignContact(
        payload.oldContactId,
        payload.newContactId,
      );
      this.logger.log(
        `Contact merged: ${payload.oldContactId} -> ${payload.newContactId} (${count} deals re-pointed)`,
      );
      timer?.();
      this.businessMetrics?.sqsMessagesProcessed.inc({ event_type: 'contact.merged', status: 'success' });
    } catch (error) {
      timer?.();
      this.businessMetrics?.sqsMessagesProcessed.inc({ event_type: 'contact.merged', status: 'error' });
      throw error;
    }
  }
}
