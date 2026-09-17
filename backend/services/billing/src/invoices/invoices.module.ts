import { Module } from '@nestjs/common';
import { BusinessProfileModule } from '../business-profile/business-profile.module';
import { DocumentsModule } from '../documents/documents.module';
import { InvoicesController } from './invoices.controller';
import { InvoicesRepository } from './invoices.repository';
import { InvoicesService } from './invoices.service';
import { OverdueSweepScheduler } from './overdue-sweep.scheduler';

@Module({
  imports: [BusinessProfileModule, DocumentsModule],
  controllers: [InvoicesController],
  providers: [InvoicesRepository, InvoicesService, OverdueSweepScheduler],
  exports: [InvoicesService],
})
export class InvoicesModule {}
