import { Controller, Get, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CurrentUser } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { TelephonyService } from './telephony.service';
import { TelephonySettingsService } from './telephony-settings.service';
import { MainNumberService } from './main-number.service';

@ApiTags('Telephony')
@ApiBearerAuth()
@Controller()
export class TelephonyController {
  constructor(
    private readonly telephonyService: TelephonyService,
    private readonly settings: TelephonySettingsService,
    private readonly main: MainNumberService,
  ) {}

  @Get('config')
  @ApiOperation({
    summary: 'Workspace telephony settings the browser needs',
    description:
      'Any authenticated user. `technicianLine` — the shared line, so the job ' +
      'screen can tell somebody what to dial from a handset with no app session; ' +
      '`mainNumber` — the workspace\'s main number (the messaging default sender, ' +
      'else the workspace caller id, else null), the pill beside the call log\'s ' +
      'heading. Neither is a secret: both are numbers people are meant to call.',
  })
  async telephonyConfig() {
    const [technicianLine, mainNumber] = await Promise.all([
      this.settings.technicianLine(),
      this.main.mainNumber(),
    ]);
    return { success: true, data: { technicianLine, mainNumber } };
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
