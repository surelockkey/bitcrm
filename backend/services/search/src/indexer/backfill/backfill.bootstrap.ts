import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BackfillService } from './backfill.service';

/**
 * Runs the index backfill automatically on boot when ENABLE_SEARCH_BACKFILL=true.
 * Non-blocking (not awaited) so it never delays startup or health checks; the
 * backfill is idempotent (upsert-only) so a re-run per task start is safe.
 * Set the flag on exactly one always-on task in prod (or trigger via
 * POST /api/search/internal/reindex) to avoid redundant scans.
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
