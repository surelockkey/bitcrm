import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { EstimatesController } from './estimates.controller';
import { EstimatesRepository } from './estimates.repository';
import { EstimatesService } from './estimates.service';
import { EstimateReportController } from './report/estimate-report.controller';
import { EstimateReportRepository } from './report/estimate-report.repository';
import { EstimateReportService } from './report/estimate-report.service';

@Module({
  imports: [DocumentsModule],
  // The report's static `estimates/report/…` paths before `estimates/:id`.
  controllers: [EstimateReportController, EstimatesController],
  providers: [EstimatesRepository, EstimatesService, EstimateReportRepository, EstimateReportService],
  exports: [EstimatesService],
})
export class EstimatesModule {}
