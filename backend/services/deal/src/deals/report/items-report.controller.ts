import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type Response } from 'express';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { ITEMS_REPORT_MAX_DAYS, ITEMS_REPORT_MAX_PAGE_SIZE, type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import { ResolvedPerms } from '../../common/decorators/resolved-permissions.decorator';
import { ItemsReportService } from './items-report.service';
import { ItemsReportQueryDto } from './items-report.query';

const QUERY_HELP =
  `\`from\`/\`to\` = YYYY-MM-DD on the account's calendar (America/New_York), both included, at most ${ITEMS_REPORT_MAX_DAYS} days, ` +
  'on the **job date**; only Done jobs count, and a service fee or discount line is never an item. ' +
  'Filters, OR inside a group and AND between groups, each comma-separated or repeated: `type` (product | service | hours | ' +
  'expense | equipment | warranty — Workiz words, matched exactly), `jobTypeId`, `category` (price-book category names; repeat ' +
  'the parameter for a name holding a comma), `soldBy` (user ids). `q` searches the item name, model # and item number. ' +
  '`sort` = number (default: newest items first) | item | model | units | category | price | cost | profit | jobs, `dir` asc | desc (default desc).';

/**
 * The Workiz Items and services report (`/root/itemsReport`). Declared ahead
 * of `DealsController` in the module, or its `GET /:id…` routes would take
 * `/report/items…`.
 */
@ApiTags('Items and services report')
@ApiBearerAuth()
@Controller('report/items')
export class ItemsReportController {
  constructor(private readonly report: ItemsReportService) {}

  @Get()
  @RequirePermission('reports', 'view')
  @ApiOperation({
    summary: 'Items and services — every price-book item the period\'s Done jobs sold, with its Total row',
    description:
      '**Guard:** `reports.view` (Workiz "Items and services"). DataScope: `deals` — `assigned_only` counts only the jobs it is on. ' +
      `${QUERY_HELP} \`page\` (1-based) and \`pageSize\` (1–${ITEMS_REPORT_MAX_PAGE_SIZE}, default 50). ` +
      'Price, Cost, Profit and margin are left out without `financials.view`. `options` lists the categories and sellers of the ' +
      'period for the filter. The period is read once and kept a minute, so paging, sorting and filtering do not read it again.',
  })
  async page(@Query() query: ItemsReportQueryDto, @CurrentUser() user: JwtUser, @ResolvedPerms() perms: ResolvedPermissions) {
    return { success: true, data: await this.report.page(query, { user, perms }) };
  }

  @Get('jobs')
  @RequirePermission('reports', 'view')
  @ApiOperation({
    summary: "One item's jobs — Workiz's expanded row",
    description:
      `**Guard:** \`reports.view\`. The page's query plus \`item\` — the row's \`key\`. One row per job (its lines of the item ` +
      'merged): job, client, job date, units, price, cost, profit, service plan, sold by — newest first, paged like the report, ' +
      `and the item's own row over the same filters. ${QUERY_HELP}`,
  })
  async jobs(@Query() query: ItemsReportQueryDto, @CurrentUser() user: JwtUser, @ResolvedPerms() perms: ResolvedPermissions) {
    return { success: true, data: await this.report.jobs(query, { user, perms }) };
  }

  @Get('export')
  @RequirePermission('reports', 'view')
  @ApiOperation({
    summary: 'Items and services as CSV — the same query, every row',
    description:
      `**Guard:** \`reports.view\`. Takes the report's query (${QUERY_HELP}). \`text/csv\` with Workiz's columns — ` +
      'Item, SKU, Units, Category, Price, Cost, Profit, Jobs, Service Plan — the first line `Totals`. The money columns are ' +
      'dropped without `financials.view`.',
  })
  async export(
    @Query() query: ItemsReportQueryDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms: ResolvedPermissions,
    @Res() res: Response,
  ): Promise<void> {
    const { csv, from, to } = await this.report.exportCsv(query, { user, perms });
    const name = `items-report-${from}_${to}.csv`.replace(/[^\w.-]/g, '');
    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(csv);
  }
}
