import { Module } from '@nestjs/common';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';
import { DealsRepository } from './deals.repository';
import { DealsCacheService } from './deals-cache.service';
import { TimelineRepository } from '../timeline/timeline.repository';
import { DealProductsRepository } from '../products/deal-products.repository';
import { InternalHttpService } from '../common/services/internal-http.service';
import { DealsEventHandler } from './deals.event-handler';

@Module({
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
