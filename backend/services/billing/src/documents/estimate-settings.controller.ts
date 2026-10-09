import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import type { JwtUser } from '@bitcrm/types';
import { UpdateEstimateSettingsDto } from './dto/estimate-settings.dto';
import { EstimateSettingsService } from './estimate-settings.service';

@ApiTags('Documents')
@ApiBearerAuth()
@Controller('estimate-settings')
export class EstimateSettingsController {
  constructor(private readonly settings: EstimateSettingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Settings → Estimates: the account’s estimate switches',
    description:
      '**Guard:** any authenticated user (the Send panel reads "Attach PDF files"). Workiz `/root/estimatesSettings`: ' +
      '`attachPdf` — an emailed estimate / invoice carries its PDF beside the portal link; `autoDeclineSameJob` — ' +
      'approving one of a job’s estimates declines the job’s other open ones. Both default ON (the account’s values).',
  })
  async get() {
    return { success: true, data: await this.settings.get() };
  }

  @Put()
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Update the account’s estimate switches',
    description: '**Guard:** `settings.edit`. Partial: only the switches sent change.',
  })
  async update(@Body() dto: UpdateEstimateSettingsDto, @CurrentUser() user: JwtUser) {
    return { success: true, data: await this.settings.update(dto, user.id) };
  }
}
