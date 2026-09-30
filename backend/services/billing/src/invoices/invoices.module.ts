import { Module } from '@nestjs/common';
import { BusinessProfileModule } from '../business-profile/business-profile.module';
import { DocumentsModule } from '../documents/documents.module';
import { PaymentsLedgerModule } from '../payments/payments-ledger.module';
import { InvoicesController } from './invoices.controller';
import { InvoicesRepository } from './invoices.repository';
import { InvoicesService } from './invoices.service';
import { OverdueSweepScheduler } from './overdue-sweep.scheduler';

@Module({
  // PaymentsLedgerModule (storage only) — the invoice's totals derive from the
  // payment ledger. PaymentsModule imports THIS one, never the other way round.
  imports: [BusinessProfileModule, DocumentsModule, PaymentsLedgerModule],
  controllers: [InvoicesController],
  providers: [InvoicesRepository, InvoicesService, OverdueSweepScheduler],
  exports: [InvoicesService],
})
export class InvoicesModule {}
