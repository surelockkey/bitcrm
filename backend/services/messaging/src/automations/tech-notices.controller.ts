import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import { ResolvedPerms } from '../outbound/resolved-perms.decorator';
import { LateDto } from './dto/late.dto';
import { OnMyWayDto } from './dto/on-my-way.dto';
import { TechNoticesService } from './tech-notices.service';

/**
 * The technician-triggered texts (design §10 M21). POST-only under the
 * `automations` prefix, so nothing here shadows `GET /automations/:id`.
 */
@ApiTags('Messaging Automations')
@ApiBearerAuth()
@Controller('automations')
export class TechNoticesController {
  constructor(private readonly service: TechNoticesService) {}

  @Post('on-my-way')
  @HttpCode(202)
  @RequirePermission('messages', 'send')
  @ApiOperation({
    summary: 'Text the client "on my way"',
    description:
      '**Guard:** `messages.send`, and the caller must be on the job roster (403 otherwise). Renders the ' +
      'settings `onMyWayMsg` text (`{{first_name}}`, `{{tech_assigned}}`, `{{eta_minutes}}`) into the client ' +
      'conversation. 422 `AUTOMATION_DISABLED` when the rule or `onMyWayMsgNotify` is off, 422 ' +
      '`RECIPIENT_OPTED_OUT` for a STOP-listed client, 404 for an unknown job. Answers 202 with the queued message.',
  })
  async onMyWay(@Body() dto: OnMyWayDto, @CurrentUser() user: JwtUser, @ResolvedPerms() perms: ResolvedPermissions | undefined) {
    const data = await this.service.onMyWay(dto, { user, perms });
    return { success: true, data };
  }

  @Post('late')
  @HttpCode(202)
  @RequirePermission('messages', 'send')
  @ApiOperation({
    summary: 'Text the client "running late"',
    description:
      '**Guard:** `messages.send`, and the caller must be on the job roster (403 otherwise). Renders the ' +
      'settings `lateMsg` text with `{{late_value}}` = `minutes` into the client conversation. Same 422 / 404 ' +
      'answers as on-my-way. Answers 202 with the queued message.',
  })
  async late(@Body() dto: LateDto, @CurrentUser() user: JwtUser, @ResolvedPerms() perms: ResolvedPermissions | undefined) {
    const data = await this.service.late(dto, { user, perms });
    return { success: true, data };
  }
}
