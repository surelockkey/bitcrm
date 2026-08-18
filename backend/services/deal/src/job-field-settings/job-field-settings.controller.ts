import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { JobFieldSettingsService } from './job-field-settings.service';
import { UpdateJobFieldSettingsDto } from './dto/update-job-field-settings.dto';

/** Which job fields are required — admin-tunable (Settings → Job Fields). */
@ApiTags('Job Field Settings')
@ApiBearerAuth()
@Controller('job-field-settings')
export class JobFieldSettingsController {
  constructor(private readonly service: JobFieldSettingsService) {}

  @Get()
  @RequirePermission('deals', 'view')
  @ApiOperation({
    summary: 'Get the required-field configuration for jobs',
    description: '**Guard:** `deals.view` — the New Job form reads it to render asterisks.',
  })
  async get() {
    const data = await this.service.get();
    return { success: true, data };
  }

  @Put()
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Update which job fields are required',
    description: '**Guard:** `settings.edit`. Unknown field ids are rejected (400).',
  })
  async update(@Body() dto: UpdateJobFieldSettingsDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.update({ requiredFields: dto.requiredFields }, user);
    return { success: true, data };
  }
}
