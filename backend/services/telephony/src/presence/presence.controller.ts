import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CurrentUser } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { PresenceService } from './presence.service';

class PresenceDto {
  online!: boolean;
}

@ApiTags('Telephony')
@ApiBearerAuth()
@Controller('presence')
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Post()
  @ApiOperation({
    summary: 'Set / refresh the current agent softphone presence',
    description:
      'The browser calls this when the phone is switched on (online=true) and ' +
      'periodically as a heartbeat, and once with online=false on switch-off. ' +
      'Online agents are the pool inbound calls ring.',
  })
  async set(@Body() dto: PresenceDto, @CurrentUser() user: JwtUser) {
    if (dto.online) {
      await this.presence.setOnline(user.id);
    } else {
      await this.presence.setOffline(user.id);
    }
    return { success: true, data: { identity: user.id, online: !!dto.online } };
  }
}
