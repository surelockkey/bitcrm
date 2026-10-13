import { Module } from '@nestjs/common';
import { JobTypesRepository } from '../job-types/job-types.repository';
import { JobSourcesRepository } from '../job-sources/job-sources.repository';
import { ExternalCompaniesRepository } from '../external-companies/external-companies.repository';
import { CustomFieldsRepository } from '../custom-fields/custom-fields.repository';
import { ServiceAreasRepository } from '../service-areas/service-areas.repository';
import { CommissionReportController } from './commission-report.controller';
import { CommissionReportService } from './commission-report.service';
import { CommissionReportRepository } from './commission-report.repository';
import { CommissionReportClient } from './commission-report.client';
import { ReportWindowCache } from '../common/cache/report-window-cache';

/**
 * The commissions report. Read-only: it writes nothing and owns no rows —
 * the catalog repositories here are its own stateless instances, used for
 * names only.
 */
@Module({
  controllers: [CommissionReportController],
  providers: [
    CommissionReportService,
    CommissionReportRepository,
    CommissionReportClient,
    JobTypesRepository,
    JobSourcesRepository,
    ExternalCompaniesRepository,
    CustomFieldsRepository,
    ServiceAreasRepository,
    ReportWindowCache,
  ],
  // Job Statistics (DealsModule) takes its Profit from the same rows; the
  // reports there share this one window cache (one single-flight map).
  exports: [CommissionReportService, ReportWindowCache],
})
export class CommissionReportModule {}
