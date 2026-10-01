import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@bitcrm/shared';
import { ActivityService } from './activity.service';
import { ActivityQueryDto } from './dto/activity-query.dto';

/**
 * `GET /api/deals/activity` — Workiz Reports → Activity. Registered ahead of
 * DealsModule so DealsController's `GET /:id` does not take "activity".
 */
@ApiTags('Activity')
@ApiBearerAuth()
@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  @RequirePermission('reports', 'view')
  @ApiOperation({
    summary: 'Activity — who did what, when',
    description:
      '**Guard:** `reports.view`. Events of the account days `from`..`to` (America/New_York), newest first ' +
      '(`sort=asc` reverses), `limit` a page (1–100, default 10), `nextCursor` to walk on. `userIds` narrows to ' +
      'those people (≤ 20; current users only — Workiz’s own filter), `q` matches the action text and the Job Id. ' +
      'A searched page may come back short with a cursor: the walk is bounded per request. Imported Workiz events ' +
      'keep Workiz’s text, user name and web/mobile mark.',
  })
  async list(@Query() query: ActivityQueryDto) {
    const { items, nextCursor } = await this.activity.list(query);
    return { success: true, data: items, pagination: { nextCursor, count: items.length } };
  }

  @Get('count')
  @RequirePermission('reports', 'view')
  @ApiOperation({
    summary: 'Activity — how many events match (the “of N”)',
    description:
      '**Guard:** `reports.view`. Same filters as the list. Unfiltered it is the days’ counters (exact); with a ' +
      'search or users it is a bounded count — `atLeast` means it stopped on its budget. Cached a minute.',
  })
  async count(@Query() query: ActivityQueryDto) {
    return { success: true, data: await this.activity.count(query) };
  }

  @Get('export')
  @RequirePermission('reports', 'view')
  @ApiOperation({
    summary: 'Activity — the rows for the CSV export',
    description:
      '**Guard:** `reports.view`. Same filters as the list, every matching row up to 10,000 (Workiz’s own ceiling); ' +
      '`truncated` says there were more.',
  })
  async export(@Query() query: ActivityQueryDto) {
    return { success: true, data: await this.activity.export(query) };
  }
}
