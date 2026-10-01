import { Controller, Get, Headers, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@bitcrm/shared';
import type { Caller } from '../../common/access';
import { CallerCtx } from '../../common/caller.decorator';
import { PaymentReportQueryDto } from './dto/payment-report-query.dto';
import { PAYMENT_REPORT_EXPORT_MAX_ROWS, PaymentReportService } from './payment-report.service';

/**
 * Workiz Reports → Payments. Static paths under `/payments/report`; the
 * ledger's `/payments/:paymentId/...` routes are POST/DELETE, so nothing
 * shadows either way.
 */
@ApiTags('Payments')
@ApiBearerAuth()
@Controller('payments/report')
export class PaymentReportController {
  constructor(private readonly report: PaymentReportService) {}

  @Get()
  @RequirePermission('payments', 'view')
  @ApiOperation({
    summary: 'Payments report — one page of lines',
    description:
      '**Guard:** `payments.view` (`assigned_only` → lines of the jobs the caller leads). Workiz’s report: ' +
      'every payment on its payment date and every refund as a negative line of its own, amounts with the ' +
      'tip included, newest first. `from`/`to` are business days (America/New_York); both absent = All ' +
      'time. `types` / `technicianIds` / `serviceAreaIds` are OR inside a group, AND between groups. The ' +
      'first page (no `cursor`) also answers `totals` — Total amount, Total tips and the count — for the ' +
      'WHOLE range, from pre-summed buckets. → `{ items, nextCursor?, totals? }`.',
  })
  async list(
    @Query() query: PaymentReportQueryDto,
    @CallerCtx() caller: Caller,
    @Headers('authorization') authorization?: string,
  ) {
    return { success: true, data: await this.report.list(query, caller, authorization) };
  }

  @Get('totals')
  @RequirePermission('payments', 'view')
  @ApiOperation({
    summary: 'Payments report — the two cards',
    description:
      '**Guard:** `payments.view`. → `{ count, amount, tips, serviceFees, byType }` for the filtered range ' +
      '(the same numbers the first page of the list carries).',
  })
  async totals(@Query() query: PaymentReportQueryDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.report.totals(query, caller) };
  }

  @Get('export')
  @RequirePermission('payments', 'view')
  @ApiOperation({
    summary: 'Payments report — CSV export',
    description:
      '**Guard:** `payments.view`. Workiz’s CSV columns (Job ID, Document, Payment type, Status, Amount, ' +
      'Service Fee, Net, Tips, Technician, Client name, Transaction method, Card, Payment date, Payment ' +
      'time, Collected by, Description, Job type, Job status, Confirmation code) for the filtered range. ' +
      `→ \`{ filename, csv, count, truncated }\`; stops at ${PAYMENT_REPORT_EXPORT_MAX_ROWS.toLocaleString('en-US')} ` +
      'rows (`truncated: true`).',
  })
  async export(
    @Query() query: PaymentReportQueryDto,
    @CallerCtx() caller: Caller,
    @Headers('authorization') authorization?: string,
  ) {
    return { success: true, data: await this.report.exportCsv(query, caller, authorization) };
  }
}
