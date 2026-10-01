import { Module } from '@nestjs/common';
import { PaymentReportRepository } from '../payments/report/payment-report.repository';
import { PaidByJobController } from './paid-by-job.controller';
import { PaidByJobService } from './paid-by-job.service';

/**
 * Billing's reads for reports that live in other services (deal-service's
 * Tax report). Its own `PaymentReportRepository` instance — stateless, the
 * same table rows the Payments report reads.
 */
@Module({
  controllers: [PaidByJobController],
  providers: [PaymentReportRepository, PaidByJobService],
})
export class BillingReportsModule {}
