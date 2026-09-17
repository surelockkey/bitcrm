import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { BusinessProfileModule } from '../business-profile/business-profile.module';
import { TemplatesModule } from '../templates/templates.module';
import { DocumentContextBuilder } from './document-context.builder';
import { DocumentsService } from './documents.service';
import { PdfService } from './pdf.service';

@Module({
  imports: [AssetsModule, BusinessProfileModule, TemplatesModule],
  providers: [PdfService, DocumentContextBuilder, DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
