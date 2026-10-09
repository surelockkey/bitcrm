import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type Response } from 'express';
import { CurrentUser, RequirePermission, getDataScopeFilter, hasPermission } from '@bitcrm/shared';
import { type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import { ResolvedPerms } from '../common/decorators/resolved-permissions.decorator';
import { CommissionReportService } from './commission-report.service';
import { CommissionReportQueryDto } from './dto/commission-report-query.dto';

const QUERY_DOC =
  '`from`/`to` (YYYY-MM-DD, up to 186 days), `by` = closed (default; the END of the visit window, as Workiz) | ' +
  'scheduled | created (the local day), `mode` = standard | tech | external, filters `techId` ' +
  '(the primary technician; without one the Tech report is every job, as in Workiz), `jobTypeId`, `serviceAreaId`, ' +
  '`externalCompanyId` (or `only`), `sourceId` (Ad Group), search `q`, `sort`/`dir`. Only Done jobs. Without ' +
  '`financials.view` every amount is 0 and no rate is sent (`money: false`); the CSV then has no amount columns.';

/**
 * Workiz's "Commissions (Legacy)" — Finance Reporting. Registered ahead of
 * DealsController, like every other module under the `api/deals` prefix.
 */
@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports/commissions')
export class CommissionReportController {
  constructor(private readonly service: CommissionReportService) {}

  @Get()
  @RequirePermission('commission', 'view')
  @ApiOperation({
    summary: 'Commissions report (Workiz Finance Reporting)',
    description:
      '**Guard:** `commission.view` permission required. DataScope `commission`: `assigned_only` sees only the jobs ' +
      'the caller is primary on. ' +
      QUERY_DOC +
      ' One page of rows (`offset`, `limit` ≤ 500) with the Totals row over the whole filtered set, per-technician ' +
      'and per-company slices. Imported jobs carry Workiz’s own frozen numbers; jobs done in BitCRM are computed with ' +
      'the Workiz formula from their ledger and the technician’s rate in force on their day.',
  })
  async report(
    @Query() query: CommissionReportQueryDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms: ResolvedPermissions,
  ) {
    const data = await this.service.report(query, user, this.scope(user, perms), hasPermission(perms, 'financials', 'view'));
    return { success: true, data };
  }

  @Get('export')
  @RequirePermission('commission', 'view')
  @ApiOperation({
    summary: 'Commissions report as CSV (Export)',
    description:
      '**Guard:** `commission.view` permission required. DataScope as above. The same query; every row of the ' +
      'filtered set, a Totals line first, the columns Workiz shows by default in the mode.',
  })
  async export(
    @Query() query: CommissionReportQueryDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms: ResolvedPermissions,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const { filename, csv } = await this.service.exportCsv(
      query,
      user,
      this.scope(user, perms),
      hasPermission(perms, 'financials', 'view'),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // A BOM so Excel reads the file as UTF-8.
    return `﻿${csv}`;
  }

  private scope(user: JwtUser, perms?: ResolvedPermissions): string {
    if (!perms) return 'assigned_only';
    return getDataScopeFilter({ id: user.id, department: user.department ?? '' }, 'commission', perms).scope;
  }
}
