import { Controller, HttpCode, Post } from '@nestjs/common';
import { ApiExcludeController, ApiOperation } from '@nestjs/swagger';
import { Internal } from '../common/decorators/internal.decorator';
import { CountersRecountService } from './counters-recount.service';

/**
 * `POST /api/messaging/internal/counters/recount` — rebuild the Inbox
 * category totals from the index partitions.
 *
 * Internal (`x-internal-secret`), not a user route: it is the operator step
 * after the Workiz loader writes conversations straight into DynamoDB, where
 * the service's own transactional ADDs never saw them. Safe to run again at
 * any time — see `CountersRecountService` for what it counts and what it
 * costs. The unread / flagged badge numbers are not touched.
 */
@ApiExcludeController()
@Controller('internal/counters')
export class CountersRecountController {
  constructor(private readonly recount: CountersRecountService) {}

  @Post('recount')
  @Internal()
  @HttpCode(200)
  @ApiOperation({ summary: 'Rebuild the Inbox category totals (internal)' })
  async post() {
    return { success: true, data: await this.recount.recount() };
  }
}
