import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { AutomationsService } from './automations.service';
import { UpdateAutomationDto } from './dto/update-automation.dto';

/**
 * `/api/messaging/automations` — rules as data (design §7.1, §10 M21),
 * `settings.view` / `settings.edit` like the messaging settings. The
 * technician-triggered sends (`POST …/on-my-way`, `POST …/late`) live in
 * `TechNoticesController`; being POST-only they never shadow `GET /:id`.
 */
@ApiTags('Messaging Automations')
@ApiBearerAuth()
@Controller('automations')
export class AutomationsController {
  constructor(private readonly service: AutomationsService) {}

  @Get()
  @RequirePermission('settings', 'view')
  @ApiOperation({
    summary: 'List automation rules',
    description:
      '**Guard:** `settings.view`. The rules the service runs (`builtin: true` — New-job SMS to technicians, ' +
      'on-my-way, late) plus every imported Workiz rule kept as data (`enabled: false`, structure as exported). ' +
      'Alphabetical by name.',
  })
  async list() {
    const data = await this.service.list();
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('settings', 'view')
  @ApiOperation({ summary: 'One automation rule', description: '**Guard:** `settings.view`.' })
  async get(@Param('id') id: string) {
    const data = await this.service.get(id);
    return { success: true, data };
  }

  @Patch(':id')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Enable, disable or rename an automation rule',
    description:
      '**Guard:** `settings.edit`. Only built-in rules can be enabled — an imported Workiz rule answers 422 ' +
      '`RULE_NOT_RUNNABLE` until the rule engine exists; disabling and renaming work for every rule.',
  })
  async update(@Param('id') id: string, @Body() dto: UpdateAutomationDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.update(id, dto, user);
    return { success: true, data };
  }
}
