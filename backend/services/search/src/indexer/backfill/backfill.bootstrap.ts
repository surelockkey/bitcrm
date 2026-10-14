import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BackfillService } from './backfill.service';

/**
 * Runs the index backfill automatically on boot when ENABLE_SEARCH_BACKFILL=true.
 * Non-blocking (not awaited) so it never delays startup or health checks; the
 * backfill is idempotent (upsert-only), so a re-run is safe — but not cheap.
 *
 * OFF by default in deployed environments: `render-taskdef.sh` does not set the
 * flag. A full backfill pages every service's internal list routes (e.g.
 * inventory's 46k-row product catalog); running it on every task start meant a
 * re-index on every deploy (31 in one week) that flooded the other services.
 * The SQS indexer keeps the index fresh; run the backfill deliberately — after a
 * Workiz import or a mapping change — via `npm run backfill -w
 * backend/services/search` or POST /api/search/internal/reindex. Turn this flag
 * on only for a one-off, on exactly one task.
 */
@Injectable()
export class BackfillBootstrap implements OnModuleInit {
  private readonly logger = new Logger(BackfillBootstrap.name);

  constructor(private readonly backfill: BackfillService) {}

  onModuleInit(): void {
    if (process.env.ENABLE_SEARCH_BACKFILL !== 'true') return;

    this.logger.log('ENABLE_SEARCH_BACKFILL=true → starting boot backfill (background)');
    this.backfill
      .run()
      .then((totals) => this.logger.log(`Boot backfill complete: ${JSON.stringify(totals)}`))
      .catch((err) => this.logger.error(`Boot backfill failed: ${(err as Error).message}`));
  }
}
