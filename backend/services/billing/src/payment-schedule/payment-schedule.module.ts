import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentScheduleController } from './payment-schedule.controller';
import { PaymentScheduleRepository } from './payment-schedule.repository';
import { PaymentScheduleService } from './payment-schedule.service';

/**
 * Workiz's Payment schedule. Reads the job's ledger (PaymentsModule) and
 * renders its invoice (InvoicesModule); neither imports this, so no cycle.
 */
@Module({
  imports: [PaymentsModule, InvoicesModule],
  controllers: [PaymentScheduleController],
  providers: [PaymentScheduleRepository, PaymentScheduleService],
})
export class PaymentScheduleModule {}
