import { Module } from '@nestjs/common';
import { SearchIndexerService } from './indexer.service';
import { IndexerEventHandler } from './indexer.event-handler';
import { EntityFetcher } from './entity-fetcher.service';
import { BackfillService } from './backfill/backfill.service';
import { BackfillController } from './backfill/backfill.controller';
import { BackfillBootstrap } from './backfill/backfill.bootstrap';

@Module({
  controllers: [BackfillController],
  providers: [
    SearchIndexerService,
    IndexerEventHandler,
    EntityFetcher,
    BackfillService,
    BackfillBootstrap,
  ],
  exports: [SearchIndexerService, IndexerEventHandler, BackfillService],
})
export class IndexerModule {}
