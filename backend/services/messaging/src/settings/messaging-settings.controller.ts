import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { MessagingSettingsService } from './messaging-settings.service';
import { UpdateMessagingSettingsDto } from './dto/update-messaging-settings.dto';

/** `/api/messaging/settings` — `settings.view` / `settings.edit`, like telephony's numbers (design §7.1, §7.5). */
@ApiTags('Messaging Settings')
@ApiBearerAuth()
@Controller('settings')
export class MessagingSettingsController {
  constructor(private readonly service: MessagingSettingsService) {}

  @Get()
  @RequirePermission('settings', 'view')
  @ApiOperation({
    summary: 'Messaging settings',
    description:
      '**Guard:** `settings.view`. Default sender and forwards, SMS prefix/signature, the tech "New job" / ' +
      '"on my way" / "late" texts, quiet hours, link base URLs, business profile for `{{biz_*}}`, STOP/HELP ' +
      'auto-replies and the company timezone. Defaults are filled in until first saved.',
  })
  async get() {
    const data = await this.service.get();
    return { success: true, data };
  }

  @Put()
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Update messaging settings',
    description:
      '**Guard:** `settings.edit`. Fields merge over the stored document: omit what you do not change, send ' +
      '`""` to clear a text field. Timezones must be IANA names (400 otherwise).',
  })
  async update(@Body() dto: UpdateMessagingSettingsDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.update(dto, user);
    return { success: true, data };
  }
}
