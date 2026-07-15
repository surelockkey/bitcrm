import { Module } from '@nestjs/common';
import { SearchIndexerService } from './indexer.service';
import { IndexerEventHandler } from './indexer.event-handler';
import { EntityFetcher } from './entity-fetcher.service';
import { BackfillService } from './backfill/backfill.service';

@Module({
  providers: [
    SearchIndexerService,
    IndexerEventHandler,
    EntityFetcher,
    BackfillService,
  ],
  exports: [SearchIndexerService, IndexerEventHandler, BackfillService],
})
export class IndexerModule {}
