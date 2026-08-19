import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CurrentUser } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { PresenceService } from './presence.service';
import { UserDirectoryService } from '../common/user-directory.service';

class PresenceDto {
  online!: boolean;
}

@ApiTags('Telephony')
@ApiBearerAuth()
@Controller('presence')
export class PresenceController {
  constructor(
    private readonly presence: PresenceService,
    private readonly directory: UserDirectoryService,
  ) {}

  @Get('online')
  @ApiOperation({
    summary: 'Teammates who can take a call right now',
    description:
      'Any authenticated user — this is the transfer / add-someone picker. ' +
      'Returns every teammate with their name, email, role and personal ' +
      'number, flagged with whether their softphone is registered. Someone ' +
      'offline is still listed: their personal number is exactly the case ' +
      'where it helps. `includeSelf=1` keeps the caller in the list, which is ' +
      'what building a call group needs — putting yourself in one is the most ' +
      'ordinary thing there is.',
  })
  async online(
    @CurrentUser() user: JwtUser,
    @Query('includeSelf') includeSelf?: string,
  ) {
    const [onlineIds, everyone] = await Promise.all([
      this.presence.listOnline(),
      this.directory.list(),
    ]);
    const online = new Set(onlineIds);
    const data = everyone
      // No point offering to transfer a call to yourself — but every point in
      // being able to add yourself to a group.
      .filter((u) => includeSelf === '1' || u.id !== user.id)
      .map((u) => ({ ...u, softphoneOnline: online.has(u.id) }))
      .sort((a, b) =>
        a.softphoneOnline === b.softphoneOnline
          ? a.name.localeCompare(b.name)
          : Number(b.softphoneOnline) - Number(a.softphoneOnline),
      );
    return { success: true, data };
  }

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
