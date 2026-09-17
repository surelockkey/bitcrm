import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { EstimatesModule } from '../estimates/estimates.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { TemplateRenderController } from './template-render.controller';

@Module({
  imports: [DocumentsModule, InvoicesModule, EstimatesModule],
  controllers: [TemplateRenderController],
})
export class TemplateRenderModule {}
