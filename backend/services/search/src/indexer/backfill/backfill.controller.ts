import { Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Internal } from '../../common/decorators/internal.decorator';
import { BackfillService } from './backfill.service';

@ApiTags('search-internal')
@Controller()
export class BackfillController {
  private readonly logger = new Logger(BackfillController.name);
  private running = false;

  constructor(private readonly backfill: BackfillService) {}

  @Post('internal/reindex')
  @Internal()
  @HttpCode(202)
  @ApiOperation({
    summary: 'Rebuild the search index from all services (internal)',
    description:
      'Fire-and-forget. **Guard:** internal service-to-service only ' +
      '(`x-internal-secret` header). Idempotent — safe to re-run.',
  })
  reindex(): { accepted: boolean; message: string } {
    if (this.running) {
      return { accepted: false, message: 'Backfill already in progress' };
    }
    this.running = true;
    // Fire-and-forget: pulls every entity from each service; can take a while.
    this.backfill
      .run()
      .then((totals) => this.logger.log(`Reindex complete: ${JSON.stringify(totals)}`))
      .catch((err) => this.logger.error(`Reindex failed: ${(err as Error).message}`))
      .finally(() => {
        this.running = false;
      });
    return { accepted: true, message: 'Backfill started' };
  }
}
