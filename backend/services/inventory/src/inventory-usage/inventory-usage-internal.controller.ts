import { Body, Controller, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Internal } from '../common/decorators/internal.decorator';
import { InventoryUsageService } from './inventory-usage.service';
import { UsageJobDto } from './dto/usage-job.dto';

@ApiTags('Inventory usage')
@Controller('usage')
export class InventoryUsageInternalController {
  constructor(private readonly usage: InventoryUsageService) {}

  @Put('internal/deals/:dealId/job')
  @Internal()
  @ApiOperation({
    summary: "Internal: re-file a job's usage rows after the job changed (for deal service)",
    description:
      '**Guard:** Internal (X-Internal-Secret header required). Service-to-service only. The body ' +
      'is the job as it is now; every usage row of the job (found through its `USAGE_OF#` ' +
      'pointers) is moved to the month / sort key of the new `scheduledDate` (none → the day of ' +
      'its first use, `jobDateMissing`) and takes the new client and technicians. Idempotent: ' +
      'rows that already say it are not written. Answers `{ rows, moved, updated }`.',
  })
  async updateJob(@Param('dealId') dealId: string, @Body() job: UsageJobDto) {
    const data = await this.usage.rekeyDeal(dealId, job);
    return { success: true, data };
  }
}
