import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { TIPS_REPORT_MAX_DAYS, type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import { ResolvedPerms } from '../../common/decorators/resolved-permissions.decorator';
import { TipsReportService } from './tips-report.service';
import { TipsReportJobsQueryDto, TipsReportQueryDto } from './tips-report.query';

const QUERY_HELP =
  `\`from\`/\`to\` = YYYY-MM-DD of the JOB DATE on the account's calendar (America/New_York), both included, at most ${TIPS_REPORT_MAX_DAYS} days. ` +
  'Filters, OR inside a group and AND between groups, each comma-separated or repeated: `techId` (whose rows), ' +
  '`jobTypeId`, `contactId` (which jobs). Every status counts, Canceled too; a job\'s tip is split equally between everyone on it.';

/**
 * The Workiz Tips report. Declared ahead of `DealsController` in the module,
 * or its `/:id/…` routes could take `report/tips`.
 */
@ApiTags('Tips report')
@ApiBearerAuth()
@Controller('report/tips')
export class TipsReportController {
  constructor(private readonly report: TipsReportService) {}

  @Get()
  @RequirePermission('reports', 'view')
  @ApiOperation({
    summary: 'The Tips report — each person\'s share of the tips of a period\'s jobs, and how many jobs they were on',
    description:
      '**Guard:** `reports.view`. DataScope: `deals` — `assigned_only` sees only their own line. ' +
      `${QUERY_HELP} Every person of the period comes back at once (never more than the team): the page sorts, ` +
      'searches, pages and exports them. `tips` is null without `financials.view`.',
  })
  async page(@Query() query: TipsReportQueryDto, @CurrentUser() user: JwtUser, @ResolvedPerms() perms: ResolvedPermissions) {
    return { success: true, data: await this.report.page(query, { user, perms }) };
  }

  @Get('jobs')
  @RequirePermission('reports', 'view')
  @ApiOperation({
    summary: 'One person\'s jobs of the period — the Tips report\'s row, opened',
    description:
      `**Guard:** \`reports.view\`; \`assigned_only\` only for themselves (403 otherwise). The report's query (${QUERY_HELP}) ` +
      'plus `tech` (the person), `sort` (default | job | jobName | client | date | jobType | total | tip; default: the order ' +
      'the jobs were created in), `dir` (default asc), `page`, `pageSize` (default 10). `total` is the whole job, `tip` their ' +
      'share; both null without `financials.view`.',
  })
  async jobs(@Query() query: TipsReportJobsQueryDto, @CurrentUser() user: JwtUser, @ResolvedPerms() perms: ResolvedPermissions) {
    return { success: true, data: await this.report.jobs(query, { user, perms }) };
  }
}
