import { Body, Controller, Delete, Logger, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { PushDevicesRepository } from './push-devices.repository';

/**
 * The device registry (`POST /devices`, `DELETE /devices/:token`).
 *
 * **No `@RequirePermission`** — the only authorisation these two routes need
 * is a valid bearer token, like `GET /events` next door. A technician's role
 * holds barely any permissions (that is the whole point of the role), so
 * gating "let me receive my own notifications" behind one would lock out
 * exactly the people the app is for. The caller is taken from the JWT and
 * never from the body, so a registration can only ever be for oneself.
 */
@ApiTags('Messaging')
@ApiBearerAuth()
@Controller('devices')
export class PushDevicesController {
  private readonly logger = new Logger(PushDevicesController.name);

  constructor(private readonly devices: PushDevicesRepository) {}

  @Post()
  @ApiOperation({
    summary: 'Register this phone for push notifications',
    description:
      '**Guard:** a valid bearer token, no permission — a technician has few, and this is how they ' +
      'receive their own jobs. The token is registered for the caller; registering one that is already ' +
      'stored refreshes it (and its TTL) rather than adding a second row, so the app can call this on ' +
      'every launch. A token last registered by another user moves to the caller — a phone handed over ' +
      'must not keep receiving the previous owner\'s jobs.',
  })
  async register(@Body() dto: RegisterDeviceDto, @CurrentUser() user: JwtUser) {
    const device = await this.devices.register({
      token: dto.token,
      userId: user.id,
      platform: dto.platform,
      appVersion: dto.appVersion,
      deviceName: dto.deviceName,
    });
    this.logger.log(`Registered ${device.platform} device for ${user.id} (${dto.deviceName ?? 'unnamed'})`);
    return { success: true, data: { token: device.token, registeredAt: device.registeredAt } };
  }

  @Delete(':token')
  @ApiOperation({
    summary: 'Stop pushing to this phone',
    description:
      '**Guard:** a valid bearer token, no permission. Removes the token only if it is registered to the ' +
      'caller, so knowing a token is not enough to silence somebody else\'s phone. Idempotent: a token ' +
      'already gone (or never the caller\'s) answers the same, because "this phone must stop receiving" ' +
      'already holds either way. An Expo token contains brackets — URL-encode it into the path.',
  })
  async unregister(@Param('token') token: string, @CurrentUser() user: JwtUser) {
    const removed = await this.devices.removeForUser(token, user.id);
    this.logger.log(`Unregister device for ${user.id}: ${removed ? 'removed' : 'nothing to remove'}`);
    return { success: true, data: { token } };
  }
}
