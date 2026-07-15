import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { TechnicianLocationService } from './technician-location.service';
import { SetLocationDto } from './dto/set-location.dto';

const TECHNICIAN_ROLE_ID = 'role-technician';

@ApiTags('Technician Location')
@ApiBearerAuth()
@Controller('technicians')
export class TechnicianLocationController {
  constructor(private readonly locationService: TechnicianLocationService) {}

  @Post(':id/location')
  @RequirePermission('technicians', 'edit')
  @ApiOperation({
    summary: 'Report a technician’s live location',
    description:
      '**Guard:** `technicians.edit` **and** self — a technician may only post ' +
      'their own location (from their own device). Stored with a short TTL, so it ' +
      'expires when they go offline.',
  })
  async setLocation(
    @Param('id') id: string,
    @Body() dto: SetLocationDto,
    @CurrentUser() user: JwtUser,
  ) {
    // Only the technician's own device reports their position.
    if (user.id !== id) {
      throw new ForbiddenException('You can only report your own location');
    }
    const data = await this.locationService.setLocation(id, dto);
    return { success: true, data };
  }

  @Delete(':id/location')
  @RequirePermission('technicians', 'edit')
  @ApiOperation({
    summary: 'Go offline (clear live location)',
    description: '**Guard:** `technicians.edit` and self. Removes the live location immediately.',
  })
  async clearLocation(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    if (user.id !== id) {
      throw new ForbiddenException('You can only clear your own location');
    }
    await this.locationService.clearLocation(id);
    return { success: true };
  }

  // Declared before nothing risky, but the path is distinct from ":id/location".
  @Get('locations')
  @RequirePermission('technicians', 'view')
  @ApiOperation({
    summary: 'Live locations of all online technicians (dispatch)',
    description:
      '**Guard:** `technicians.view`, and **not** a field technician — a technician ' +
      'sees the map from their own app, not everyone else’s position. Powers the ' +
      'dispatch map’s live layer; absent technicians fall back to their derived position.',
  })
  async listLocations(@CurrentUser() user: JwtUser) {
    if (user.roleId === TECHNICIAN_ROLE_ID) {
      throw new ForbiddenException(
        'Field technicians cannot view other technicians’ locations',
      );
    }
    const data = await this.locationService.listLocations();
    return { success: true, data };
  }
}
