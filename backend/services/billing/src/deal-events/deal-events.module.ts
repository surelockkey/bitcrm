import { Module } from '@nestjs/common';
import { EstimatesModule } from '../estimates/estimates.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { DealEventsHandler } from './deal-events.handler';

@Module({
  imports: [InvoicesModule, EstimatesModule],
  providers: [DealEventsHandler],
})
export class DealEventsModule {}
