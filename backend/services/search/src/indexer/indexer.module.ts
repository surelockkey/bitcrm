import { Module } from '@nestjs/common';
import { SearchIndexerService } from './indexer.service';
import { IndexerEventHandler } from './indexer.event-handler';
import { CatalogNamesService } from './catalog-names.service';
import { EntityFetcher } from './entity-fetcher.service';
import { BackfillService } from './backfill/backfill.service';
import { BackfillController } from './backfill/backfill.controller';
import { BackfillBootstrap } from './backfill/backfill.bootstrap';
import { ProductListModule } from '../product-list/product-list.module';

@Module({
  // The product backfill stamps the Price Book list ready (ProductListReadiness).
  imports: [ProductListModule],
  controllers: [BackfillController],
  providers: [
    SearchIndexerService,
    CatalogNamesService,
    IndexerEventHandler,
    EntityFetcher,
    BackfillService,
    BackfillBootstrap,
  ],
  exports: [SearchIndexerService, IndexerEventHandler, BackfillService],
})
export class IndexerModule {}
