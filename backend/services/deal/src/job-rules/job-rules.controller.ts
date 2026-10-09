import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { JobRulesService } from './job-rules.service';
import { UpdateJobRulesDto } from './dto/update-job-rules.dto';

/** The account's job rules (Settings → Account Preferences; Workiz Account → Preferences). */
@ApiTags('Job Rules')
@ApiBearerAuth()
@Controller('job-rules')
export class JobRulesController {
  constructor(private readonly service: JobRulesService) {}

  @Get()
  @RequirePermission('deals', 'view')
  @ApiOperation({
    summary: 'Get the account-wide job rules',
    description: '**Guard:** `deals.view` — anyone who sees jobs may read what happens to them on close.',
  })
  async get() {
    const data = await this.service.get();
    return { success: true, data };
  }

  @Put()
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Change the account-wide job rules',
    description: '**Guard:** `settings.edit`. Fields left out keep their value.',
  })
  async update(@Body() dto: UpdateJobRulesDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.update(dto, user);
    return { success: true, data };
  }
}
