import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { EstimatesModule } from '../estimates/estimates.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { DocumentEmailAttachmentsService } from './document-email-attachments.service';
import { DocumentSendController } from './document-send.controller';

/**
 * The Send panel's server side for Workiz "Attach PDF files": the PDF a
 * document's email carries. Sits above both document modules (which both
 * import DocumentsModule), so neither has to know about the other.
 */
@Module({
  imports: [DocumentsModule, EstimatesModule, InvoicesModule],
  controllers: [DocumentSendController],
  providers: [DocumentEmailAttachmentsService],
})
export class DocumentSendModule {}
