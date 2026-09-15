import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Internal } from '../common/decorators/internal.decorator';
import { ReconcileDto } from './dto/reconcile.dto';
import { ReconcileService, type ReconcileReport } from './reconcile.service';

/**
 * `POST /api/messaging/internal/reconcile` — the on-demand trigger of the
 * Twilio log reconciliation (M8). The hourly run is the same call from a
 * scheduler with the internal secret (`backend/README.md`, messaging rollout);
 * the backend has no in-process scheduler.
 */
@ApiTags('Messaging internal')
@Controller('internal')
export class ReconcileController {
  constructor(private readonly reconcile: ReconcileService) {}

  @Post('reconcile')
  @HttpCode(200)
  @Internal()
  @ApiOperation({
    summary: "Insert messages missing from the inbox by comparing with Twilio's message log",
    description:
      '**Guard:** `x-internal-secret` (service-to-service). Lists the Twilio ' +
      'account messages sent in `[since, until]` (default: the last 90 minutes) ' +
      'and stores those with no `PSID#` pointer — inbound through the webhook ' +
      'pipeline, outbound adopted onto an unclaimed line or inserted with ' +
      "Twilio's status. Idempotent: rerunning a window changes nothing.",
  })
  async run(@Body() dto: ReconcileDto): Promise<{ success: true; data: ReconcileReport }> {
    const data = await this.reconcile.run(dto);
    return { success: true, data };
  }
}
