import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Internal } from '../common/decorators/internal.decorator';
import { isDay } from '../payments/report/payment-report.rules';
import { PaidByJobService } from './paid-by-job.service';

/**
 * Billing's internal reads for other services' reports. deal-service's Tax
 * report (Paid tab) asks what each job collected in a window.
 */
@ApiTags('Reports (internal)')
@Controller('reports/internal')
export class PaidByJobController {
  constructor(private readonly paid: PaidByJobService) {}

  @Get('paid-by-job')
  @Internal()
  @ApiOperation({
    summary: 'What each job collected in a window (internal)',
    description:
      '**Guard:** Internal service-to-service only (`x-internal-secret` header required). `from`/`to` = business ' +
      'days (America/New_York), inclusive, at most 25 months. From the Payments report lines (payment date): ' +
      '`[{ dealId, paid }]`, paid = Σ (amount − tip), refunds and reversals netted, pending/failed left out.',
  })
  async paidByJob(@Query('from') from?: string, @Query('to') to?: string) {
    if (!isDay(from) || !isDay(to) || from > to) throw new BadRequestException('from/to must be YYYY-MM-DD, from ≤ to');
    return { success: true, data: await this.paid.window(from, to) };
  }
}
