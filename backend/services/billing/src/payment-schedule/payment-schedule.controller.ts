import { Body, Controller, Delete, Get, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@bitcrm/shared';
import type { Caller } from '../common/access';
import { CallerCtx } from '../common/caller.decorator';
import { SavePaymentScheduleDto } from './dto/save-payment-schedule.dto';
import { PaymentScheduleService } from './payment-schedule.service';

const truthy = (v: string | undefined) => v === '1' || v === 'true';

/**
 * Workiz's Payment schedule on a job, under `/deals/:dealId/...` beside the
 * job's ledger. Who may see the job is the ledger's own rule (`payments`,
 * assigned-only for a technician); the figures come from that ledger.
 */
@ApiTags('Payment schedule')
@ApiBearerAuth()
@Controller('deals')
export class PaymentScheduleController {
  constructor(private readonly schedules: PaymentScheduleService) {}

  @Get(':dealId/payment-schedule')
  @RequirePermission('payments', 'view')
  @ApiOperation({
    summary: "A job's payment schedule",
    description:
      '**Guard:** `payments.view` (`assigned_only` → the caller’s jobs). → `null` when the job has none, else ' +
      '`{ method, total, amountPaid, balanceDue, lines }` — each line its dollars (a percentage split to the cent, ' +
      'the last taking the rest), what the job’s payments have settled of it in order, what is left, and ' +
      '`paid` / `overdue` / `due` / `future` against today (the business’s day).',
  })
  async get(@Param('dealId') dealId: string, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.schedules.get(dealId, caller) };
  }

  @Put(':dealId/payment-schedule')
  @RequirePermission('payments', 'collect')
  @ApiOperation({
    summary: "Set a job's payment schedule (replaces it)",
    description:
      '**Guard:** `payments.collect` (technicians hold it, `assigned_only`). 400 unless the percentages make 100 or ' +
      'the amounts make the job total, every payment has a due day, or when the job has nothing to pay.',
  })
  async save(@Param('dealId') dealId: string, @Body() dto: SavePaymentScheduleDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.schedules.save(dealId, dto, caller) };
  }

  @Delete(':dealId/payment-schedule')
  @RequirePermission('payments', 'collect')
  @ApiOperation({ summary: "Remove a job's payment schedule", description: '**Guard:** `payments.collect`.' })
  async remove(@Param('dealId') dealId: string, @CallerCtx() caller: Caller) {
    await this.schedules.remove(dealId, caller);
    return { success: true, data: { deleted: true } };
  }

  @Get(':dealId/payment-schedule/:lineId/pdf')
  @RequirePermission('invoices', 'view')
  @ApiOperation({
    summary: "One scheduled payment's invoice PDF",
    description:
      '**Guard:** `invoices.view` + the job’s ledger access. The job’s invoice with its Balance due that payment’s ' +
      '(Workiz’s View). 409 when the job has no invoice yet; 404 for a payment not on the schedule.',
  })
  async pdf(
    @Param('dealId') dealId: string,
    @Param('lineId') lineId: string,
    @Query('download') download: string | undefined,
    @CallerCtx() caller: Caller,
  ) {
    return { success: true, data: await this.schedules.pdf(dealId, lineId, truthy(download), caller) };
  }
}
