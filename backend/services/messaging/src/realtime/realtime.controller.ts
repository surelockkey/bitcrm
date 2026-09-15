import { Controller, ForbiddenException, Get, Logger, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type Response } from 'express';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import { PermissionLookupService } from '../api/access/permission-lookup.service';
import { ResolvedPerms } from '../api/access/resolved-permissions.decorator';
import { CountersService } from '../api/counters/counters.service';
import { type MessagingRealtimeEvent } from './realtime-events';
import { RealtimeFilterService, SCOPED_COUNTERS_MIN_INTERVAL_MS, throttleTrailing } from './realtime-filter.service';
import { RealtimeSubscriber } from './realtime.subscriber';

/** Below the ALB idle timeout of 60 s (design §7.6). */
export const SSE_HEARTBEAT_MS = 25_000;

/**
 * Live updates for the inbox (design §7.6): one SSE stream per tab fed by
 * Redis pub/sub, plus the polling fallback for the badge counters.
 */
@ApiTags('Messaging')
@ApiBearerAuth()
@Controller()
export class RealtimeController {
  private readonly logger = new Logger(RealtimeController.name);

  constructor(
    private readonly subscriber: RealtimeSubscriber,
    private readonly filter: RealtimeFilterService,
    private readonly permissions: PermissionLookupService,
    private readonly counters: CountersService,
  ) {}

  @Get('events')
  @ApiOperation({
    summary: 'Server-sent events stream of inbox updates',
    description:
      '**Guard:** `messages.view` or `team_chat.view` (checked here — the permission guard ' +
      'cannot express "either"). Bearer token as on every route (open it with a fetch stream, ' +
      'EventSource cannot send headers). Emits `conversation.upserted`, `message.upserted`, ' +
      '`counters.changed` and `opt_out.changed` as `data:` frames, each filtered by the ' +
      "caller's data scope and masked per `contacts.view_numbers` at send time; permissions are " +
      're-resolved per event (60 s memo) so a revoked viewer goes quiet within a minute. ' +
      'Heartbeat comment every 25 s. Fallback when the stream is unavailable: poll ' +
      '`GET /counters` every 30 s and the open feed every 10 s.',
  })
  async stream(@Res() res: Response, @CurrentUser() user: JwtUser): Promise<void> {
    const perms = await this.permissions.resolve(user);
    let viewer = this.filter.viewerFor(user, perms);
    if (!this.filter.mayConnect(viewer)) {
      throw new ForbiddenException('messages.view or team_chat.view required');
    }

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // Tell nginx not to buffer this response — required for live delivery.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(': connected\n\n');

    let open = true;
    const write = (event: MessagingRealtimeEvent) => {
      if (open) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // An assigned_only viewer's counters are a recount over their threads;
    // bursts collapse into one recount per interval.
    const scopedCounters = throttleTrailing(async () => {
      const filtered = await this.filter.forViewer(
        { type: 'counters.changed', at: new Date().toISOString(), counters: { unreadConversations: 0, flaggedConversations: 0, unreadByKind: {} } },
        viewer,
      );
      if (filtered) write(filtered);
    }, SCOPED_COUNTERS_MIN_INTERVAL_MS);

    const subscription = this.subscriber.stream().subscribe((event) => {
      void (async () => {
        // Re-resolved per event, memoised for 60 s: a stream outlives a
        // permission change by hours.
        const fresh = await this.permissions.resolve(user);
        viewer = this.filter.viewerFor(user, fresh);
        if (!this.filter.mayConnect(viewer)) return;

        if (event.type === 'counters.changed' && viewer.scope.scope !== 'all') {
          if (viewer.mayViewMessages) scopedCounters.call();
          return;
        }
        const filtered = await this.filter.forViewer(event, viewer);
        if (filtered) write(filtered);
      })().catch((err) => {
        // A failed lookup must never fall through to the unfiltered event.
        this.logger.warn(`dropped ${event.type} for ${user.id}: ${err instanceof Error ? err.message : err}`);
      });
    });

    const heartbeat = setInterval(() => res.write(': hb\n\n'), SSE_HEARTBEAT_MS);

    res.on('close', () => {
      open = false;
      clearInterval(heartbeat);
      scopedCounters.cancel();
      subscription.unsubscribe();
      res.end();
    });
  }

  @Get('counters')
  @RequirePermission('messages', 'view')
  @ApiOperation({
    summary: 'Unread / flagged badge counters (polling fallback)',
    description:
      '**Guard:** `messages.view` permission required. The same numbers `counters.changed` ' +
      'pushes over the stream — `{ unreadConversations, flaggedConversations, unreadByKind }`, ' +
      'company-wide for full scope, counted over their own threads for `assigned_only`. ' +
      'Poll every 30 s when the stream is unavailable.',
  })
  async getCounters(@CurrentUser() user: JwtUser, @ResolvedPerms() perms?: ResolvedPermissions) {
    return { success: true, data: await this.counters.get(user, perms) };
  }
}
