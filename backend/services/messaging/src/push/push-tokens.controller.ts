import { Body, Controller, Delete, HttpCode, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { PushTokensService } from './push-tokens.service';

/**
 * The technician app's device registration for push notifications. No
 * permission: every signed-in user registers their own phone (a
 * subcontractor cannot sign in, an inactive user is refused by the auth
 * guard), and nothing here reads or changes another user's devices.
 */
@ApiTags('Push notifications')
@ApiBearerAuth()
@Controller('push-tokens')
export class PushTokensController {
  constructor(private readonly service: PushTokensService) {}

  @Put()
  @HttpCode(204)
  @ApiOperation({
    summary: "Register this phone's Expo push token for the caller",
    description:
      '**Guard:** any signed-in user, for themselves (no permission). `{ token, platform }` — `token` is ' +
      '`ExponentPushToken[…]` / `ExpoPushToken[…]`, `platform` `ios | android`. Idempotent; a user may hold ' +
      'several devices. A token another user held moves to the caller (sign-in on a shared van phone), and ' +
      'the previous user stops getting that phone\'s notifications. Answers 204.',
  })
  async register(@Body() dto: RegisterPushTokenDto, @CurrentUser() user: JwtUser): Promise<void> {
    await this.service.register(user.id, dto);
  }

  @Delete(':token')
  @HttpCode(204)
  @ApiOperation({
    summary: "Forget this phone's push token (sign-out)",
    description:
      '**Guard:** any signed-in user, for themselves (no permission). Removes the token only when the caller ' +
      'owns it; an unknown token, or one that has moved to another user, changes nothing. Always 204.',
  })
  async unregister(@Param('token') token: string, @CurrentUser() user: JwtUser): Promise<void> {
    await this.service.unregister(user.id, token);
  }
}
