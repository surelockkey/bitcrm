import { Controller, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CurrentUser } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { TelephonyService } from './telephony.service';

@ApiTags('Telephony')
@ApiBearerAuth()
@Controller()
export class TelephonyController {
  constructor(private readonly telephonyService: TelephonyService) {}

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
