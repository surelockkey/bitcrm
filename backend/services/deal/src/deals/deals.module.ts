import { Module } from '@nestjs/common';
import { ServiceAreasModule } from '../service-areas/service-areas.module';
import { JobTypesModule } from '../job-types/job-types.module';
import { JobSourcesModule } from '../job-sources/job-sources.module';
import { JobTagsModule } from '../job-tags/job-tags.module';
import { TechnicianEligibilityModule } from '../technician-eligibility/technician-eligibility.module';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';
import { DealsRepository } from './deals.repository';
import { DealsCacheService } from './deals-cache.service';
import { TimelineRepository } from '../timeline/timeline.repository';
import { DealProductsRepository } from '../products/deal-products.repository';
import { InternalHttpService } from '../common/services/internal-http.service';
import { DealsEventHandler } from './deals.event-handler';

@Module({
  imports: [ServiceAreasModule, JobTypesModule, JobSourcesModule, JobTagsModule, TechnicianEligibilityModule],
  controllers: [DealsController],
  providers: [
    DealsService,
    DealsRepository,
    DealsCacheService,
    TimelineRepository,
    DealProductsRepository,
    InternalHttpService,
    DealsEventHandler,
  ],
  exports: [DealsService, DealsEventHandler],
})
export class DealsModule {}
