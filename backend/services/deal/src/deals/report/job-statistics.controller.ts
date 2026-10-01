import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { JOBS_REPORT_MAX_DAYS, type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import { ResolvedPerms } from '../../common/decorators/resolved-permissions.decorator';
import { JobStatisticsService } from './job-statistics.service';
import { JobsReportQueryDto } from './jobs-report.query';

/**
 * Workiz's Job Statistics. Declared ahead of `DealsController` in the module,
 * like the Jobs report, or its `GET /:id/…` routes would take `/report/…`.
 */
@ApiTags('Job Statistics')
@ApiBearerAuth()
@Controller('report/statistics')
export class JobStatisticsController {
  constructor(private readonly statistics: JobStatisticsService) {}

  @Get()
  @RequirePermission('reports', 'view')
  @ApiOperation({
    summary: 'Job Statistics — a period of jobs as KPIs, a day series and the Workiz breakdowns',
    description:
      '**Guard:** `reports.view` (Workiz "Statistics Report"). DataScope: `deals` — `assigned_only` counts only the jobs it is on. ' +
      '`by` = created | scheduled | end (Workiz "Closed" — the visit\'s END, not the moment the job was closed; the default); ' +
      `\`from\`/\`to\` = YYYY-MM-DD on the account's calendar (America/New_York), both included, at most ${JOBS_REPORT_MAX_DAYS} days. ` +
      'Filters as the Jobs report\'s (OR inside a group, AND between groups): `serviceAreaId`, `tagId`, and `status`, `techId`, ' +
      '`createdBy`, `jobTypeId`, `origin`, `sourceId`, `externalCompanyId`. ' +
      'Answers the six KPIs (Done, Submitted, In Progress, Canceled, Total Sales, Total Profit), one row per day (Jobs counts ' +
      'canceled jobs too), and the tables Sources (ad-group description, external companies as their own rows), Tech (the ' +
      'whole team as one "A + B" row, plus unassigned), Area by service area / city / zip (a job without an area in none), ' +
      'Dispatcher (the creator) and Job Types, each with All / Done / Open / Canceled / Canceled % / Gross / Profit / ' +
      'Average Sale / Average Profit and a Totals row; Tech adds Labor cost and Tech expenses. Gross is the Done jobs\' total; ' +
      'Profit is the company\'s after the technician\'s share (Commissions (Legacy) Company Profit). Every amount is left ' +
      'out without `financials.view`; Profit also without `reports.view_profit`; a table without its `reports.view_*_statistics` ' +
      '(an explicit false — a role without the key keeps it). The window is read once and kept a minute.',
  })
  async get(
    @Query() query: JobsReportQueryDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms: ResolvedPermissions,
  ) {
    const data = await this.statistics.statistics(query, { user, perms });
    return { success: true, data };
  }
}
