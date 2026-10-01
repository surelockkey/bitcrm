import { Module } from '@nestjs/common';
import { BusinessProfileModule } from '../business-profile/business-profile.module';
import { DocumentsModule } from '../documents/documents.module';
import { PaymentsLedgerModule } from '../payments/payments-ledger.module';
import { SignaturesModule } from '../signatures/signatures.module';
import { InvoicesController } from './invoices.controller';
import { InvoiceReportController } from './report/invoice-report.controller';
import { InvoiceReportRepository } from './report/invoice-report.repository';
import { InvoiceReportService } from './report/invoice-report.service';
import { InvoicesRepository } from './invoices.repository';
import { InvoicesService } from './invoices.service';
import { OverdueSweepScheduler } from './overdue-sweep.scheduler';
import { UnpaidInvoicesRepository } from './unpaid-invoices.repository';

@Module({
  // PaymentsLedgerModule (storage only) — the invoice's totals derive from the
  // payment ledger. PaymentsModule imports THIS one, never the other way round.
  imports: [BusinessProfileModule, DocumentsModule, PaymentsLedgerModule, SignaturesModule],
  // The report's static paths (`aging`, `report/…`) before the `:id` routes.
  controllers: [InvoiceReportController, InvoicesController],
  providers: [
    InvoicesRepository,
    UnpaidInvoicesRepository,
    InvoicesService,
    OverdueSweepScheduler,
    InvoiceReportRepository,
    InvoiceReportService,
  ],
  exports: [InvoicesService, InvoicesRepository, UnpaidInvoicesRepository],
})
export class InvoicesModule {}
