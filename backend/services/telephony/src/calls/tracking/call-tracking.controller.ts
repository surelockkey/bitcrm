import { Controller, ForbiddenException, Get, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { hasPermission, RequirePermission } from '@bitcrm/shared';
import { type ResolvedPermissions } from '@bitcrm/types';
import { CallTrackingService } from './call-tracking.service';

/**
 * `GET /api/telephony/calls/stats/tracking` — Workiz Reports → Call Tracking.
 * Two segments under `calls/`, so CallsController's `GET :sid` never takes it.
 */
@ApiTags('Telephony')
@ApiBearerAuth()
@Controller('calls')
export class CallTrackingController {
  constructor(private readonly tracking: CallTrackingService) {}

  @Get('stats/tracking')
  @RequirePermission('reports', 'view')
  @ApiOperation({
    summary: 'Call Tracking — inbound calls by call flow or by tracked number',
    description:
      '**Guard:** `reports.view`, and `calls.view` (Workiz’s “Call Reports” restriction maps onto it); revenue only ' +
      'with `financials.view`. `from`..`to` are account days (YYYY-MM-DD, America/New_York, inclusive, at most 366). ' +
      '`groupBy` = `flows` (default) | `numbers`; `graphBy` = `hour` (default, hour of the day) | `day` | `week` | `month`. ' +
      'Rows busiest first — every known number in the number view, zeros included; seven cards computed as Workiz ' +
      'does (sums, and plain means of the rows for Avg Duration and Conversion); the graph by flow. Served from a ' +
      'snapshot (5 min while the window includes today, until the next nightly run otherwise); `refresh=1` rebuilds it.',
  })
  async report(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('groupBy') groupBy: string | undefined,
    @Query('graphBy') graphBy: string | undefined,
    @Query('refresh') refresh: string | undefined,
    @Req() req: { resolvedPermissions?: ResolvedPermissions },
  ) {
    const perms = req.resolvedPermissions;
    if (!hasPermission(perms, 'calls', 'view')) {
      throw new ForbiddenException('Call reports need calls.view');
    }
    const data = await this.tracking.report(
      { from, to, groupBy, graphBy },
      {
        withRevenue: hasPermission(perms, 'financials', 'view'),
        fresh: refresh === '1' || refresh === 'true',
      },
    );
    return { success: true, data };
  }
}
