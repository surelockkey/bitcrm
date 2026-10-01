import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Internal } from '../common/decorators/internal.decorator';
import { DealTotalsDto } from './dto/deal-totals.dto';
import { DealTotalsRepository } from './deal-totals.repository';

/**
 * `POST /api/deals/internal/deal-totals` — the totals of many jobs at once,
 * for telephony's Call Tracking revenue. Registered before DealsModule, like
 * every `internal/*` route that is not a deal id.
 */
@ApiTags('Deals')
@Controller('internal')
export class DealTotalsController {
  constructor(private readonly repo: DealTotalsRepository) {}

  @Post('deal-totals')
  @HttpCode(200)
  @Internal()
  @ApiOperation({
    summary: 'Internal: the totals of a set of jobs',
    description:
      '**Guard:** internal secret (`x-internal-secret`). `{ ids }` (at most 1000) → `{ [dealId]: total }`, ' +
      '`totals.total` of each job (else an imported job’s `jobTotalPrice`), whatever its status; unknown ids are absent.',
  })
  async totals(@Body() dto: DealTotalsDto) {
    return { success: true, data: await this.repo.totalsOf(dto.ids ?? []) };
  }
}
