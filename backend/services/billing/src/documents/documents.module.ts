import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { BusinessProfileModule } from '../business-profile/business-profile.module';
import { SignaturesModule } from '../signatures/signatures.module';
import { TemplatesModule } from '../templates/templates.module';
import { DocumentContextBuilder } from './document-context.builder';
import { DocumentSettingsController } from './document-settings.controller';
import { DocumentSettingsRepository } from './document-settings.repository';
import { DocumentSettingsService } from './document-settings.service';
import { DocumentsService } from './documents.service';
import { EstimateSettingsController } from './estimate-settings.controller';
import { EstimateSettingsRepository } from './estimate-settings.repository';
import { EstimateSettingsService } from './estimate-settings.service';
import { PdfService } from './pdf.service';

@Module({
  imports: [AssetsModule, BusinessProfileModule, TemplatesModule, SignaturesModule],
  // Settings → Estimates lives here (not in EstimatesModule, which imports
  // this module): EstimatesService reads it on approval without a cycle.
  controllers: [DocumentSettingsController, EstimateSettingsController],
  providers: [
    PdfService,
    DocumentContextBuilder,
    DocumentsService,
    DocumentSettingsRepository,
    DocumentSettingsService,
    EstimateSettingsRepository,
    EstimateSettingsService,
  ],
  exports: [DocumentsService, DocumentSettingsService, EstimateSettingsService],
})
export class DocumentsModule {}
