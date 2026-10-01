import { Module } from '@nestjs/common';
import { JobTypesRepository } from '../job-types/job-types.repository';
import { JobSourcesRepository } from '../job-sources/job-sources.repository';
import { ExternalCompaniesRepository } from '../external-companies/external-companies.repository';
import { CustomFieldsRepository } from '../custom-fields/custom-fields.repository';
import { CommissionReportController } from './commission-report.controller';
import { CommissionReportService } from './commission-report.service';
import { CommissionReportRepository } from './commission-report.repository';
import { CommissionReportClient } from './commission-report.client';

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
  ],
  // Job Statistics (DealsModule) takes its Profit from the same rows.
  exports: [CommissionReportService],
})
export class CommissionReportModule {}
