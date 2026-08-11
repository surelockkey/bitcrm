import { Injectable, Logger, Optional } from '@nestjs/common';
import { BusinessMetricsService } from '@bitcrm/shared';
import { DealsService } from './deals.service';

@Injectable()
export class DealsEventHandler {
  private readonly logger = new Logger(DealsEventHandler.name);

  constructor(
    private readonly dealsService: DealsService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {}

  async handlePaymentReceived(payload: any): Promise<void> {
    const timer = this.businessMetrics?.sqsProcessingDuration.startTimer({ event_type: 'payment.received' });
    try {
      this.logger.log(`Payment received for deal ${payload.dealId}`);
      await this.dealsService.updatePaymentStatus(payload.dealId, {
        paymentId: payload.paymentId,
        amount: payload.amount,
        paidAt: payload.paidAt,
      });
      timer?.();
      this.businessMetrics?.sqsMessagesProcessed.inc({ event_type: 'payment.received', status: 'success' });
    } catch (error) {
      timer?.();
      this.businessMetrics?.sqsMessagesProcessed.inc({ event_type: 'payment.received', status: 'error' });
      throw error;
    }
  }

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
