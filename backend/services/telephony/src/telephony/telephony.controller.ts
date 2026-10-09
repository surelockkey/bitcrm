import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, ValidateIf } from 'class-validator';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { TelephonyService } from './telephony.service';
import { TelephonySettingsService } from './telephony-settings.service';
import { MainNumberService } from './main-number.service';

class FallbackNumberDto {
  @ApiPropertyOptional({
    nullable: true,
    example: '(888) 899-6849',
    description: 'Any format; stored as E.164. null clears it.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  phoneNumber?: string | null;
}

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
      'heading; `fallbackNumber` — where a call goes when its flow ends unanswered ' +
      '(Workiz\'s Fallback Number on the Call flows tab). None is a secret: all are ' +
      'numbers people are meant to call.',
  })
  async telephonyConfig() {
    const [{ technicianLine, fallbackNumber }, mainNumber] = await Promise.all([
      this.settings.get(),
      this.main.mainNumber(),
    ]);
    return { success: true, data: { technicianLine, mainNumber, fallbackNumber } };
  }

  @Put('config/fallback-number')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Set or clear the account fallback number',
    description:
      '**Guard:** `settings.edit`. The outside number a call is forwarded to when ' +
      'its flow ends with nobody answering, or when a number with no usable flow ' +
      'finds nobody online. Any phone number — it is not one of ours. `null` clears it.',
  })
  async setFallbackNumber(@Body() dto: FallbackNumberDto) {
    // No ValidationPipe here: a string or an explicit null; anything else = clear.
    const raw = typeof dto?.phoneNumber === 'string' ? dto.phoneNumber : null;
    const data = await this.settings.setFallbackNumber(raw);
    return { success: true, data };
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
