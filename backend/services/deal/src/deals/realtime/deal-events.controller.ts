import { Controller, Get, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type Response } from 'express';
import { RequirePermission } from '@bitcrm/shared';
import { DealEventsBus } from './deal-events.bus';

/** Below the ALB idle timeout of 60 s. */
export const DEAL_STREAM_HEARTBEAT_MS = 25_000;

/**
 * Live job updates for the web: one SSE stream per tab. Registered ahead of
 * `DealsController`, whose `GET /:id` would otherwise take `/stream`.
 */
@ApiTags('Deals')
@ApiBearerAuth()
@Controller()
export class DealEventsController {
  constructor(private readonly bus: DealEventsBus) {}

  @Get('stream')
  @RequirePermission('deals', 'view')
  @ApiOperation({
    summary: 'Server-sent events stream of deal changes',
    description:
      '**Guard:** `deals.view` permission required. Bearer token as on every route (open it with a fetch ' +
      'stream, EventSource cannot send headers). Emits `{ type: "deal.changed", dealId, at }` as `data:` ' +
      'frames after any write to a deal, its creation included — the id only, so the client rereads ' +
      'through the scoped routes. Heartbeat comment every 25 s. Fallback when the stream is unavailable: ' +
      'poll the open lists every 30 s.',
  })
  stream(@Res() res: Response): void {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // Tell nginx not to buffer this response — required for live delivery.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(': connected\n\n');

    const subscription = this.bus.stream().subscribe((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(': hb\n\n'), DEAL_STREAM_HEARTBEAT_MS);

    res.on('close', () => {
      clearInterval(heartbeat);
      subscription.unsubscribe();
      res.end();
    });
  }
}
