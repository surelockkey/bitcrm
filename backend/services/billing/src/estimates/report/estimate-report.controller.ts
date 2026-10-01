import { Controller, Get, Headers, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@bitcrm/shared';
import type { Caller } from '../../common/access';
import { CallerCtx } from '../../common/caller.decorator';
import { EstimateReportQueryDto } from './dto/estimate-report-query.dto';
import { ESTIMATE_REPORT_EXPORT_MAX_ROWS, EstimateReportService } from './estimate-report.service';

/**
 * Workiz Reports → Estimates. Static paths under `/estimates/report`,
 * registered BEFORE `EstimatesController` so `GET /estimates/:id` never
 * swallows them.
 */
@ApiTags('Estimates')
@ApiBearerAuth()
@Controller('estimates/report')
export class EstimateReportController {
  constructor(private readonly report: EstimateReportService) {}

  @Get('summary')
  @RequirePermission('estimates', 'view')
  @ApiOperation({
    summary: 'Estimates report — the six status cards',
    description:
      '**Guard:** `estimates.view`. Count and Σ Amount per status (Unsent, Pending, Approved, Declined, Won, ' +
      'Archived) plus `total`, for estimates CREATED in `from`–`to` (business days; both absent = All time). ' +
      'Amount = Workiz’s own figure on an imported, un-repriced estimate (`workizTotal`, which leaves out ' +
      'unpicked optional items), else `totals.total`. Cached 30 s per window.',
  })
  async summary(@Query() query: EstimateReportQueryDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.report.summary(query, caller) };
  }

  @Get('count')
  @RequirePermission('estimates', 'view')
  @ApiOperation({ summary: 'Estimates report — rows under the filter', description: '**Guard:** `estimates.view`. `{ total, atLeast }`.' })
  async count(@Query() query: EstimateReportQueryDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.report.count(query, caller) };
  }

  @Get('export')
  @RequirePermission('estimates', 'view')
  @ApiOperation({
    summary: 'Estimates report — CSV',
    description:
      '**Guard:** `estimates.view`. Workiz’s CSV: Estimate #, Estimate Name, Client, Email, Created, Created By, ' +
      `Amount, Status, Job. → \`{ filename, csv, count, truncated }\`; stops at ${ESTIMATE_REPORT_EXPORT_MAX_ROWS.toLocaleString('en-US')} rows.`,
  })
  async export(
    @Query() query: EstimateReportQueryDto,
    @CallerCtx() caller: Caller,
    @Headers('authorization') authorization?: string,
  ) {
    return { success: true, data: await this.report.exportCsv(query, caller, authorization) };
  }

  @Get()
  @RequirePermission('estimates', 'view')
  @ApiOperation({
    summary: 'Estimates report — one page',
    description:
      '**Guard:** `estimates.view` (`assigned_only` → the caller’s jobs). Newest first; created window, ' +
      '`status`, `search` (number or name). → `{ items, nextCursor? }`.',
  })
  async list(@Query() query: EstimateReportQueryDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.report.list(query, caller) };
  }
}
