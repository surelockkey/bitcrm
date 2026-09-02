import { Controller, Get, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CurrentUser } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { TelephonyService } from './telephony.service';
import { TelephonySettingsService } from './telephony-settings.service';

@ApiTags('Telephony')
@ApiBearerAuth()
@Controller()
export class TelephonyController {
  constructor(
    private readonly telephonyService: TelephonyService,
    private readonly settings: TelephonySettingsService,
  ) {}

  @Get('config')
  @ApiOperation({
    summary: 'Workspace telephony settings the browser needs',
    description:
      'Any authenticated user. Currently just the shared technician line, so ' +
      'the job screen can tell somebody what to dial from a handset with no ' +
      'app session. Not a secret — it is a number technicians are meant to ' +
      'call, and it is printed on the job card.',
  })
  async telephonyConfig() {
    return {
      success: true,
      data: { technicianLine: await this.settings.technicianLine() },
    };
  }

  @Post('token')
  @ApiOperation({
    summary: 'Mint a Twilio Voice access token for the browser softphone',
    description:
      'Returns a short-lived Twilio AccessToken (VoiceGrant) scoped to the ' +
      'current user as the client identity. Any authenticated user.',
  })
  token(@CurrentUser() user: JwtUser) {
    const data = this.telephonyService.generateAccessToken(user.id);
    return { success: true, data };
  }
}
