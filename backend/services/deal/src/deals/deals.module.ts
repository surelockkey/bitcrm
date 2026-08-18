import { Module } from '@nestjs/common';
import { ServiceAreasModule } from '../service-areas/service-areas.module';
import { JobTypesModule } from '../job-types/job-types.module';
import { JobSourcesModule } from '../job-sources/job-sources.module';
import { JobTagsModule } from '../job-tags/job-tags.module';
import { JobStatusesModule } from '../job-statuses/job-statuses.module';
import { JobFieldSettingsModule } from '../job-field-settings/job-field-settings.module';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { TechnicianEligibilityModule } from '../technician-eligibility/technician-eligibility.module';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';
import { DealsRepository } from './deals.repository';
import { DealsCacheService } from './deals-cache.service';
import { TimelineRepository } from '../timeline/timeline.repository';
import { DealProductsRepository } from '../products/deal-products.repository';
import { DealProductsBackfill } from '../products/deal-products.backfill';
import { InternalHttpService } from '../common/services/internal-http.service';
import { DealsEventHandler } from './deals.event-handler';
import { DealAttachmentsController } from './attachments/deal-attachments.controller';
import { DealAttachmentsService } from './attachments/deal-attachments.service';
import { DealAttachmentsRepository } from './attachments/deal-attachments.repository';

@Module({
  imports: [ServiceAreasModule, JobTypesModule, JobSourcesModule, JobTagsModule, JobStatusesModule, JobFieldSettingsModule, CustomFieldsModule, TechnicianEligibilityModule],
  // Attachments controller before Deals so `/:id/attachments` isn't shadowed by `/:id`.
  controllers: [DealAttachmentsController, DealsController],
  providers: [
    DealsService,
    DealsRepository,
    DealsCacheService,
    TimelineRepository,
    DealProductsRepository,
    DealProductsBackfill,
    InternalHttpService,
    DealsEventHandler,
    DealAttachmentsService,
    DealAttachmentsRepository,
  ],
  exports: [DealsService, DealsEventHandler],
})
export class DealsModule {}
