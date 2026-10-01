import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { BusinessProfileModule } from '../business-profile/business-profile.module';
import { TemplatesModule } from '../templates/templates.module';
import { DocumentContextBuilder } from './document-context.builder';
import { DocumentSettingsController } from './document-settings.controller';
import { DocumentSettingsRepository } from './document-settings.repository';
import { DocumentSettingsService } from './document-settings.service';
import { DocumentsService } from './documents.service';
import { PdfService } from './pdf.service';

@Module({
  imports: [AssetsModule, BusinessProfileModule, TemplatesModule],
  controllers: [DocumentSettingsController],
  providers: [PdfService, DocumentContextBuilder, DocumentsService, DocumentSettingsRepository, DocumentSettingsService],
  exports: [DocumentsService, DocumentSettingsService],
})
export class DocumentsModule {}
