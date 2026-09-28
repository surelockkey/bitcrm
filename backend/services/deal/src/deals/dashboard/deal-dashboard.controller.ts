import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import type { JwtUser, ResolvedPermissions } from '@bitcrm/types';
import { ResolvedPerms } from '../../common/decorators/resolved-permissions.decorator';
import { splitRefresh, WidgetWindowQueryDto } from './widget-window-query.dto';
import { TodayQueryDto } from './today-query.dto';
import { DealDashboardService } from './deal-dashboard.service';

const mayMoney = (perms?: ResolvedPermissions): boolean => perms?.permissions?.financials?.view === true;

const WHOLE_ACCOUNT =
  'Counts the whole account, not the caller\'s rows — a widget is shared with a role or it is not. ' +
  'Served from a snapshot built nightly at 3 AM Eastern and kept until the next; `computedAt` says when. ' +
  '`refresh=1` rebuilds it now.';

/**
 * The dashboard's job widgets, one route each.
 *
 * Every route is guarded by **its widget's own grant**, never `deals.view`:
 * hiding a widget from a role has to mean its numbers are refused to that
 * role, or they are one DevTools tab away (US-03-03). Amounts additionally
 * need `financials.view`, the same rule as every report.
 *
 * Registered ahead of `DealsController`, whose `:id/…` routes would otherwise
 * be tried first.
 */
@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('stats')
export class DealDashboardController {
  constructor(private readonly dashboard: DealDashboardService) {}

  @Get('sales')
  @RequirePermission('dashboard', 'view_sales')
  @ApiOperation({
    summary: '"Sales" — billed and net per day',
    description:
      '**Guard:** `dashboard.view_sales` **and** `financials.view` — the widget is nothing but money, so ' +
      'without the second it is refused outright. Done jobs by the day they closed (`from`..`to`, inclusive, ' +
      'at most 92 days): `total` is what was billed, `net` is total − tax − company cost. ' + WHOLE_ACCOUNT,
  })
  async sales(
    @Query() query: WidgetWindowQueryDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms: ResolvedPermissions,
  ) {
    if (!mayMoney(perms)) throw new ForbiddenException('Sales need financials.view');
    const { window, opts } = splitRefresh(query);
    return { success: true, data: await this.dashboard.sales(window, user, opts) };
  }

  @Get('top-sources')
  @RequirePermission('dashboard', 'view_top_sources')
  @ApiOperation({
    summary: '"Top Sources" — the four sources most jobs came from',
    description:
      '**Guard:** `dashboard.view_top_sources`. Jobs by the day they were created; each slice\'s `percent` ' +
      'is its share of the four shown. Jobs without a source are left out. ' + WHOLE_ACCOUNT,
  })
  async topSources(@Query() query: WidgetWindowQueryDto, @CurrentUser() user: JwtUser) {
    const { window, opts } = splitRefresh(query);
    return { success: true, data: await this.dashboard.shares('source', window, user, opts) };
  }

  @Get('top-job-types')
  @RequirePermission('dashboard', 'view_top_job_types')
  @ApiOperation({
    summary: '"Top Job Types" — the four job types with the most jobs',
    description: '**Guard:** `dashboard.view_top_job_types`. As `top-sources`, by job type. ' + WHOLE_ACCOUNT,
  })
  async topJobTypes(@Query() query: WidgetWindowQueryDto, @CurrentUser() user: JwtUser) {
    const { window, opts } = splitRefresh(query);
    return { success: true, data: await this.dashboard.shares('jobType', window, user, opts) };
  }

  @Get('service-areas')
  @RequirePermission('dashboard', 'view_service_areas')
  @ApiOperation({
    summary: '"Service Areas" — the four areas with the most jobs',
    description: '**Guard:** `dashboard.view_service_areas`. As `top-sources`, by service area. ' + WHOLE_ACCOUNT,
  })
  async serviceAreas(@Query() query: WidgetWindowQueryDto, @CurrentUser() user: JwtUser) {
    const { window, opts } = splitRefresh(query);
    return { success: true, data: await this.dashboard.shares('serviceArea', window, user, opts) };
  }

  @Get('tech-scoreboard')
  @RequirePermission('dashboard', 'view_tech_scoreboard')
  @ApiOperation({
    summary: '"Tech Scoreboard" — the five technicians who sold most',
    description:
      '**Guard:** `dashboard.view_tech_scoreboard`. Done jobs by the day they closed; a job shared by techs ' +
      'counts for each and splits its money. Ranked by sales with `financials.view`, else by jobs and ' +
      'without amounts. ' + WHOLE_ACCOUNT,
  })
  async techScoreboard(
    @Query() query: WidgetWindowQueryDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms: ResolvedPermissions,
  ) {
    const { window, opts } = splitRefresh(query);
    return { success: true, data: await this.dashboard.scoreboard('tech', window, user, mayMoney(perms), opts) };
  }

  @Get('dispatch-scoreboard')
  @RequirePermission('dashboard', 'view_dispatch_scoreboard')
  @ApiOperation({
    summary: '"Dispatch Scoreboard" — the five job creators whose jobs sold most',
    description: '**Guard:** `dashboard.view_dispatch_scoreboard`. As `tech-scoreboard`, by who created the job. ' + WHOLE_ACCOUNT,
  })
  async dispatchScoreboard(
    @Query() query: WidgetWindowQueryDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms: ResolvedPermissions,
  ) {
    const { window, opts } = splitRefresh(query);
    return { success: true, data: await this.dashboard.scoreboard('dispatch', window, user, mayMoney(perms), opts) };
  }

  @Get('today')
  @RequirePermission('dashboard', 'view_today')
  @ApiOperation({
    summary: '"Today" — sales, done, canceled and created on one day',
    description:
      '**Guard:** `dashboard.view_today`. `day` is the viewer\'s own calendar day. Done/canceled and sales ' +
      'are the jobs that closed that day; created are those opened that day. `sales` only with ' +
      '`financials.view`. ' + WHOLE_ACCOUNT,
  })
  async today(
    @Query() query: TodayQueryDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms: ResolvedPermissions,
  ) {
    return { success: true, data: await this.dashboard.today(query.day, user, mayMoney(perms)) };
  }

  @Get('jobs-now')
  @RequirePermission('dashboard', 'view_jobs')
  @ApiOperation({
    summary: '"Jobs" — how many jobs stand in each unclosed state now',
    description:
      '**Guard:** `dashboard.view_jobs`. Submitted, pending, in progress and done-pending-approval — the ' +
      'jobs board\'s own tab counts, over the whole account. Cached for thirty seconds.',
  })
  async jobsNow(@CurrentUser() user: JwtUser) {
    return { success: true, data: await this.dashboard.jobsNow(user) };
  }
}
