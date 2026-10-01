import { Body, Controller, Get, Headers, Logger, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { type Response } from 'express';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import {
  SALES_REPORT_BY,
  SALES_REPORT_COLUMN_IDS,
  SALES_REPORT_MAX_DAYS,
  SALES_REPORT_MAX_PAGE_SIZE,
  type JwtUser,
  type ResolvedPermissions,
  type SalesReportBy,
} from '@bitcrm/types';
import { ResolvedPerms } from '../../common/decorators/resolved-permissions.decorator';
import { SalesReportService } from './sales-report.service';
import { SalesReportQueryDto } from './sales-report.query';

export class UpdateSalesReportSettingsDto {
  @ApiPropertyOptional({ enum: SALES_REPORT_COLUMN_IDS, isArray: true, description: 'Visible columns; at least one. Stored in the report order.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  columns?: string[];

  @ApiProperty({ enum: SALES_REPORT_BY, required: false, description: 'The "By:" a fresh report opens on.' })
  @IsOptional()
  @IsIn(SALES_REPORT_BY as unknown as string[])
  by?: SalesReportBy;
}

const QUERY_HELP =
  `\`by\` = created | scheduled (Job date, the default) | end (Job end date); ` +
  `\`from\`/\`to\` = YYYY-MM-DD on the account's calendar (America/New_York), both included, at most ${SALES_REPORT_MAX_DAYS} days. ` +
  'A job is in when its status is not Canceled and its total is above zero. Filters, OR inside a group and AND between groups, ' +
  'each comma-separated or repeated: `status`, `techId`, `jobTypeId`, `paymentStatus` (paid | partly_paid | due), `sourceId`, `serviceAreaId`. ' +
  '`q` searches the job number, invoice number, client name, company, email and job name — not the phone, as Workiz. ' +
  '`sort` is any column id (default `jobNumber`: newest first), `dir` asc | desc (default desc).';

/**
 * The Workiz Sales report. Declared ahead of `DealsController` in the module,
 * with the other report controllers.
 */
@ApiTags('Sales report')
@ApiBearerAuth()
@Controller('report/sales')
export class SalesReportController {
  private readonly logger = new Logger(SalesReportController.name);

  constructor(private readonly report: SalesReportService) {}

  @Get()
  @RequirePermission('reports', 'view')
  @ApiOperation({
    summary: 'The Sales report — every job of a period with its money, a Total row and a day chart',
    description:
      '**Guard:** `reports.view` (Workiz "Sales Report"). DataScope: `deals` — `assigned_only` sees only the jobs it is on. ' +
      `${QUERY_HELP} \`page\` (1-based) and \`pageSize\` (1–${SALES_REPORT_MAX_PAGE_SIZE}, default 10). ` +
      'Every amount, the Total row\'s sums and the chart are left out without `financials.view`; a phone is withheld without ' +
      '`contacts.view_numbers`. The window is read once off the index of its date and kept a minute.',
  })
  async page(
    @Query() query: SalesReportQueryDto,
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
    summary: 'The Sales report as CSV — the same query, the Total row first, every job, the visible columns',
    description:
      `**Guard:** \`reports.view\`. Takes the report's query (${QUERY_HELP}) plus \`columns\` — the visible ones, ` +
      'comma-separated; default the account setting. Streams `text/csv` (Workiz headers and date format), no row cap. ' +
      'Money columns are dropped without `financials.view`.',
  })
  async export(
    @Query() query: SalesReportQueryDto,
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
          const name = `sales-report-${query.from ?? ''}_${query.to ?? query.from ?? ''}.csv`.replace(/[^\w.-]/g, '');
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
      this.logger.error(`Sales report export failed mid-stream: ${(err as Error).message}`);
      res.destroy(err as Error);
    }
  }

  @Get('settings')
  @RequirePermission('reports', 'view')
  @ApiOperation({
    summary: 'The Sales report settings — visible columns and the default "By:"',
    description: '**Guard:** `reports.view`. Per account, as Workiz keeps `salesReportSettings`.',
  })
  async settings() {
    return { success: true, data: await this.report.getSettings() };
  }

  @Put('settings')
  @RequirePermission('reports', 'edit')
  @ApiOperation({
    summary: 'Save the Sales report settings for the whole account',
    description:
      '**Guard:** `reports.edit` — the change is everyone\'s, like Workiz\'s "Save fields". `columns` must keep at least one; ' +
      'they are stored in the report order.',
  })
  async saveSettings(@Body() dto: UpdateSalesReportSettingsDto, @CurrentUser() user: JwtUser) {
    return { success: true, data: await this.report.saveSettings(dto, user) };
  }
}
