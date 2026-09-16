import { Body, Controller, HttpCode, NotFoundException, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Internal } from '../common/decorators/internal.decorator';
import { ReconcileDto } from './dto/reconcile.dto';
import { SyncMessageDto } from './dto/sync-message.dto';
import { ReconcileService, type MessageSyncResult, type ReconcileReport } from './reconcile.service';

/**
 * `POST /api/messaging/internal/reconcile` — the on-demand trigger of the
 * Twilio log reconciliation (M8). The hourly run is the same call from a
 * scheduler with the internal secret (`backend/README.md`, messaging rollout);
 * the backend has no in-process scheduler.
 *
 * `POST /api/messaging/internal/reconcile/message` — the same status
 * comparison for one outbound line, fetched by its sid: what to call when a
 * bubble sits at `sending` although Twilio's console already shows the
 * outcome (a status callback that never reached this deployment).
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
      "Twilio's status. A known outbound line whose status Twilio reports further " +
      'along (a lost status callback) gets that status, as the callback would have ' +
      'written it (`synced`). Idempotent: rerunning a window changes nothing.',
  })
  async run(@Body() dto: ReconcileDto): Promise<{ success: true; data: ReconcileReport }> {
    const data = await this.reconcile.run(dto);
    return { success: true, data };
  }

  @Post('reconcile/message')
  @HttpCode(200)
  @Internal()
  @ApiOperation({
    summary: "Sync one outbound message's status from Twilio",
    description:
      '**Guard:** `x-internal-secret` (service-to-service). Fetches the message by its ' +
      'Twilio sid and, when Twilio reports a status that outranks the stored one ' +
      '(`sent` → `delivered`, `sending` → `failed` with the error code…), writes it ' +
      'exactly as the status callback would have — rank guard, error text, ' +
      '`message.status_changed` on a terminal status, realtime update. Answers the ' +
      'outcome (`synced`, `unchanged`, `no_provider_sid`, `not_syncable`) with the ' +
      'message as it is afterwards; 404 when there is no such message.',
  })
  async syncMessage(@Body() dto: SyncMessageDto): Promise<{ success: true; data: MessageSyncResult }> {
    const data = await this.reconcile.syncMessage({
      conversationId: dto.conversationId,
      createdAt: dto.createdAt,
      messageId: dto.messageId,
    });
    if (data.outcome === 'not_found') throw new NotFoundException('Message not found');
    return { success: true, data };
  }
}
