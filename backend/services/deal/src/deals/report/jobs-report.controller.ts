import { Body, Controller, Get, Headers, Logger, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { type Response } from 'express';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import {
  JOBS_REPORT_BY,
  JOBS_REPORT_COLUMN_IDS,
  JOBS_REPORT_MAX_DAYS,
  JOBS_REPORT_MAX_PAGE_SIZE,
  type JobsReportBy,
  type JwtUser,
  type ResolvedPermissions,
} from '@bitcrm/types';
import { ResolvedPerms } from '../../common/decorators/resolved-permissions.decorator';
import { JobsReportService } from './jobs-report.service';
import { JobsReportQueryDto } from './jobs-report.query';

export class UpdateJobsReportSettingsDto {
  @ApiPropertyOptional({ enum: JOBS_REPORT_COLUMN_IDS, isArray: true, description: 'Visible columns; at least one. Stored in the report order.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  columns?: string[];

  @ApiProperty({ enum: JOBS_REPORT_BY, required: false, description: 'The "By:" a fresh report opens on.' })
  @IsOptional()
  @IsIn(JOBS_REPORT_BY as unknown as string[])
  by?: JobsReportBy;
}

const QUERY_HELP =
  `\`by\` = created | scheduled (Job date) | end (Job end date, the visit's end — not the closing moment); ` +
  `\`from\`/\`to\` = YYYY-MM-DD on the account's calendar (America/New_York), both included, at most ${JOBS_REPORT_MAX_DAYS} days. ` +
  'Filters, OR inside a group and AND between groups, each comma-separated or repeated: `status` (`done` or `done:<subStatusId>`), ' +
  '`techId`, `createdBy`, `tagId`, `jobTypeId`, `origin` (lead | new), `sourceId`, `serviceAreaId`, `externalCompanyId`. ' +
  '`q` searches job #, job name, client, phone, email and address. `sort` is any column id (default `created`), `dir` asc | desc (default desc).';

/**
 * The Workiz Jobs report. Declared ahead of `DealsController` in the module,
 * or its `GET /:id` would take `/report`.
 */
@ApiTags('Jobs report')
@ApiBearerAuth()
@Controller('report')
export class JobsReportController {
  private readonly logger = new Logger(JobsReportController.name);

  constructor(private readonly report: JobsReportService) {}

  @Get()
  @RequirePermission('reports', 'view')
  @ApiOperation({
    summary: 'The Jobs report — every job of a period, any status, paged on the server',
    description:
      '**Guard:** `reports.view` (Workiz "Job Report"). DataScope: `deals` — `assigned_only` sees only the jobs it is on. ' +
      `${QUERY_HELP} \`page\` (1-based) and \`pageSize\` (1–${JOBS_REPORT_MAX_PAGE_SIZE}, default 50). ` +
      'Money (Total, amount due) is left out without `financials.view`; a phone is withheld without `contacts.view_numbers`. ' +
      'The window is read once off the index of its date and kept a minute, so paging, sorting and filtering do not read it again.',
  })
  async page(
    @Query() query: JobsReportQueryDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms: ResolvedPermissions,
    @Headers('authorization') authorization?: string,
  ) {
    const data = await this.report.page(query, { user, perms, authorization });
    return { success: true, data };
  }

  @Get('export')
  @RequirePermission('reports', 'view')
  @ApiOperation({
    summary: 'The Jobs report as CSV — the same query, every row, the visible columns',
    description:
      `**Guard:** \`reports.view\`. Takes the report's query (${QUERY_HELP}) plus \`columns\` — the visible ones, ` +
      'comma-separated; default the account setting. Streams `text/csv` (Workiz headers and date format), every row of the ' +
      'window, no row cap. Total is dropped without `financials.view`, numbers without `contacts.view_numbers`.',
  })
  async export(
    @Query() query: JobsReportQueryDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms: ResolvedPermissions,
    @Res() res: Response,
    @Headers('authorization') authorization?: string,
  ): Promise<void> {
    let started = false;
    const sink = {
      write: (chunk: string): Promise<void> => {
        if (!started) {
          started = true;
          const name = `jobs-report-${query.from ?? ''}_${query.to ?? query.from ?? ''}.csv`.replace(/[^\w.-]/g, '');
          res.status(200);
          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
          res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('X-Content-Type-Options', 'nosniff');
        }
        return new Promise((resolve) => {
          if (res.write(chunk)) resolve();
          else res.once('drain', () => resolve());
        });
      },
    };
    try {
      await this.report.exportCsv(query, { user, perms, authorization }, sink);
      res.end();
    } catch (err) {
      // Before the first byte this is an ordinary error response.
      if (!started) throw err;
      this.logger.error(`Jobs report export failed mid-stream: ${(err as Error).message}`);
      res.destroy(err as Error);
    }
  }

  @Get('settings')
  @RequirePermission('reports', 'view')
  @ApiOperation({
    summary: 'The Jobs report settings — visible columns and the default "By:"',
    description: '**Guard:** `reports.view`. Per account, as Workiz keeps `jobReportSettings`.',
  })
  async settings() {
    return { success: true, data: await this.report.getSettings() };
  }

  @Put('settings')
  @RequirePermission('reports', 'edit')
  @ApiOperation({
    summary: 'Save the Jobs report settings for the whole account',
    description:
      '**Guard:** `reports.edit` — the change is everyone\'s, like Workiz\'s "Save fields". `columns` must keep at least one; ' +
      'they are stored in the report order.',
  })
  async saveSettings(@Body() dto: UpdateJobsReportSettingsDto, @CurrentUser() user: JwtUser) {
    return { success: true, data: await this.report.saveSettings(dto, user) };
  }
}
