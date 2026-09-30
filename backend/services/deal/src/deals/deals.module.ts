import { Module } from '@nestjs/common';
import { ServiceAreasModule } from '../service-areas/service-areas.module';
import { JobTypesModule } from '../job-types/job-types.module';
import { JobSourcesModule } from '../job-sources/job-sources.module';
import { ExternalCompaniesModule } from '../external-companies/external-companies.module';
import { JobTagsModule } from '../job-tags/job-tags.module';
import { JobStatusesModule } from '../job-statuses/job-statuses.module';
import { JobFieldSettingsModule } from '../job-field-settings/job-field-settings.module';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { TechnicianEligibilityModule } from '../technician-eligibility/technician-eligibility.module';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';
import { DealsRepository } from './deals.repository';
import { DealsCacheService } from './deals-cache.service';
import { DealEventsBus } from './realtime/deal-events.bus';
import { DealEventsController } from './realtime/deal-events.controller';
import { TimelineRepository } from '../timeline/timeline.repository';
import { DealProductsRepository } from '../products/deal-products.repository';
import { DealProductsBackfill } from '../products/deal-products.backfill';
import { InternalHttpService } from '../common/services/internal-http.service';
import { DealsEventHandler } from './deals.event-handler';
import { DealAttachmentsController } from './attachments/deal-attachments.controller';
import { DealAttachmentsService } from './attachments/deal-attachments.service';
import { DealAttachmentsRepository } from './attachments/deal-attachments.repository';
import { TaxRatesModule } from '../tax-rates/tax-rates.module';
import { BusinessProfilesClientModule } from '../common/services/business-profiles.module';
import { DealBillingController } from './billing/deal-billing.controller';
import { DealBillingService } from './billing/deal-billing.service';
import { DealTaxResolver } from './billing/deal-tax.resolver';
import { DealDashboardController } from './dashboard/deal-dashboard.controller';
import { DealDashboardService } from './dashboard/deal-dashboard.service';
import { DashboardSnapshotScheduler } from './dashboard/dashboard-snapshot.scheduler';
import { JobsReportController } from './report/jobs-report.controller';
import { JobsReportService } from './report/jobs-report.service';
import { JobsReportSettingsRepository } from './report/jobs-report-settings.repository';

@Module({
  imports: [ServiceAreasModule, JobTypesModule, JobSourcesModule, ExternalCompaniesModule, JobTagsModule, JobStatusesModule, JobFieldSettingsModule, CustomFieldsModule, TechnicianEligibilityModule, TaxRatesModule, BusinessProfilesClientModule],
  // Attachments and billing controllers before Deals so their `/:id/...` and
  // `internal/:id/...` routes are matched ahead of DealsController's; the
  // live stream too, or `GET /:id` would take `/stream`; the dashboard's
  // `stats/*` too, ahead of the `:id/…` routes; the Jobs report's `report/*`
  // likewise.
  controllers: [
    DealEventsController,
    DealAttachmentsController,
    DealBillingController,
    DealDashboardController,
    JobsReportController,
    DealsController,
  ],
  providers: [
    DealsService,
    DealsRepository,
    DealsCacheService,
    DealEventsBus,
    TimelineRepository,
    DealProductsRepository,
    DealProductsBackfill,
    InternalHttpService,
    DealsEventHandler,
    DealAttachmentsService,
    DealAttachmentsRepository,
    DealTaxResolver,
    DealBillingService,
    DealDashboardService,
    DashboardSnapshotScheduler,
    JobsReportService,
    JobsReportSettingsRepository,
  ],
  exports: [DealsService, DealsEventHandler],
})
export class DealsModule {}
