import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { DocumentsModule } from '../documents/documents.module';
import { NumberingModule } from '../numbering/numbering.module';
import { SignaturesModule } from '../signatures/signatures.module';
import { EstimatesController } from './estimates.controller';
import { EstimatesRepository } from './estimates.repository';
import { EstimatesService } from './estimates.service';
import { EstimateReportController } from './report/estimate-report.controller';
import { EstimateReportRepository } from './report/estimate-report.repository';
import { EstimateReportService } from './report/estimate-report.service';

@Module({
  // NumberingModule: a client estimate's number comes from Settings → Numbering.
  imports: [AssetsModule, DocumentsModule, SignaturesModule, NumberingModule],
  // The report's static `estimates/report/…` paths before `estimates/:id`.
  controllers: [EstimateReportController, EstimatesController],
  providers: [EstimatesRepository, EstimatesService, EstimateReportRepository, EstimateReportService],
  exports: [EstimatesService],
})
export class EstimatesModule {}
