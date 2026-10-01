import { Controller, Get, Headers, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@bitcrm/shared';
import type { Caller } from '../../common/access';
import { CallerCtx } from '../../common/caller.decorator';
import { AgingQueryDto, InvoiceReportQueryDto, InvoiceReportWindowDto } from './dto/invoice-report-query.dto';
import { INVOICE_REPORT_EXPORT_MAX_ROWS, InvoiceReportService } from './invoice-report.service';

/**
 * Workiz Reports → Aging invoices and the Invoices report page. Static paths
 * under `/invoices`, registered BEFORE `InvoicesController` so `GET
 * /invoices/:id` never swallows `aging` or `report`.
 */
@ApiTags('Invoices')
@ApiBearerAuth()
@Controller('invoices')
export class InvoiceReportController {
  constructor(private readonly report: InvoiceReportService) {}

  @Get('aging')
  @RequirePermission('invoices', 'view')
  @ApiOperation({
    summary: 'Aging invoices — cards + one page',
    description:
      '**Guard:** `invoices.view` (`assigned_only` → the caller’s jobs). Workiz’s Aging invoices, always “as of ' +
      'today” (America/New_York): `cards.all` = EVERY unpaid invoice (due or not yet), `under30` / `from30to60` / ' +
      '`from60to90` / `over90` = overdue ones by Days Late (`[1,30) [30,60) [60,90) [90,∞)`); Days Late = ' +
      'today − due date, never below 0. `bucket` picks the card the table shows; any column sorts (default Days ' +
      'Late, oldest first). Reads UnpaidIndex; `indexReady: false` = not backfilled yet (answered from the full list).',
  })
  async aging(
    @Query() query: AgingQueryDto,
    @CallerCtx() caller: Caller,
    @Headers('authorization') authorization?: string,
  ) {
    return { success: true, data: await this.report.aging(query, caller, authorization) };
  }

  @Get('aging/export')
  @RequirePermission('invoices', 'view')
  @ApiOperation({
    summary: 'Aging invoices — CSV',
    description:
      '**Guard:** `invoices.view`. Workiz’s CSV: Invoice No., Invoice Name, Client Name, Total, Balance, Due ' +
      'Date, Created At, Days By — for the chosen card. → `{ filename, csv, count, truncated }`.',
  })
  async agingExport(
    @Query() query: AgingQueryDto,
    @CallerCtx() caller: Caller,
    @Headers('authorization') authorization?: string,
  ) {
    return { success: true, data: await this.report.agingExport(query, caller, authorization) };
  }

  @Get('report/summary')
  @RequirePermission('invoices', 'view')
  @ApiOperation({
    summary: 'Invoices report — the four cards',
    description:
      '**Guard:** `invoices.view`. Workiz’s cards for invoices CREATED in `from`–`to` (business days; both ' +
      'absent = All time): Due = every unpaid one (overdue included), Overdue = unpaid past its due date ' +
      '(counted live), Unsent = unpaid and never sent. Need invoices = jobs with items and no invoice, ' +
      'account-wide (not windowed, as in Workiz). Reads UnpaidIndex, never the whole list.',
  })
  async summary(
    @Query() query: InvoiceReportWindowDto,
    @CallerCtx() caller: Caller,
    @Headers('authorization') authorization?: string,
  ) {
    return { success: true, data: await this.report.summary(query, caller, authorization) };
  }

  @Get('report/count')
  @RequirePermission('invoices', 'view')
  @ApiOperation({
    summary: 'Invoices report — how many rows the filter selects',
    description: '**Guard:** `invoices.view`. Same query as the list. `{ total, atLeast }`; `null` under `assigned_only` on the full list.',
  })
  async count(@Query() query: InvoiceReportQueryDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.report.count(query, caller) };
  }

  @Get('report/export')
  @RequirePermission('invoices', 'view')
  @ApiOperation({
    summary: 'Invoices report — CSV',
    description:
      '**Guard:** `invoices.view`. Workiz’s CSV columns: Invoice NO., Invoice Name, Client, Email Address, ' +
      'Created, Subtotal, Discount, Tax, Total Amount, Amount Due, Status (“Paid - sent on …”), Job, Job name. ' +
      `→ \`{ filename, csv, count, truncated }\`; stops at ${INVOICE_REPORT_EXPORT_MAX_ROWS.toLocaleString('en-US')} rows.`,
  })
  async export(
    @Query() query: InvoiceReportQueryDto,
    @CallerCtx() caller: Caller,
    @Headers('authorization') authorization?: string,
  ) {
    return { success: true, data: await this.report.exportCsv(query, caller, authorization) };
  }

  @Get('report')
  @RequirePermission('invoices', 'view')
  @ApiOperation({
    summary: 'Invoices report — one page',
    description:
      '**Guard:** `invoices.view` (`assigned_only` → the caller’s jobs). Newest first. `from`/`to` = created, ' +
      'business days. `statuses` (paid, partially_paid, due, overdue — Due is every unpaid one), `daysDue` ' +
      '(0_30 … over_120, on the due date, unpaid only), `sent` (sent / unsent) — OR inside a group, AND between ' +
      'groups; `search` = invoice number or name. A filter that can only select unpaid invoices is answered ' +
      'from UnpaidIndex. Each row carries `report` — Workiz’s figures: Subtotal without the card service fee, ' +
      'Amount with the tip, Due 0 and Status Paid when a cent or less is owed. → `{ items, nextCursor? }`.',
  })
  async list(
    @Query() query: InvoiceReportQueryDto,
    @CallerCtx() caller: Caller,
    @Headers('authorization') authorization?: string,
  ) {
    return { success: true, data: await this.report.list(query, caller, authorization) };
  }
}
