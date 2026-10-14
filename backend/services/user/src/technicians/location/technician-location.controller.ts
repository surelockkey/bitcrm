import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { type Response } from 'express';
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
      'their own location (from their own device). The newest fix replaces the ' +
      'previous one and is kept for 12 hours after the last report, so a technician ' +
      'who stops posting is off the map by the next morning; the map itself dims a ' +
      'pin after 90 s and shows "Last seen" from `updatedAt`.\n\n' +
      'Whether the fix is stored is the manager’s call: the card’s **Track location** ' +
      '(`gpsTrackingEnabled` on `GET /technicians/:id/profile`), and never for a ' +
      'subcontractor. When it is off the fix is **accepted and dropped** — `204`, no ' +
      'body, nothing stored, and any earlier fix of theirs removed — rather than refused, ' +
      'so a phone on an older build that keeps posting sees no errors.',
  })
  @ApiResponse({ status: 201, description: 'Stored; the body carries the fix with its server `updatedAt`.' })
  @ApiResponse({
    status: 204,
    description: 'Accepted and dropped: Track location is off for this technician, or they are a subcontractor.',
  })
  async setLocation(
    @Param('id') id: string,
    @Body() dto: SetLocationDto,
    @CurrentUser() user: JwtUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Only the technician's own device reports their position.
    if (user.id !== id) {
      throw new ForbiddenException('You can only report your own location');
    }
    const data = await this.locationService.setLocation(id, dto);
    if (!data) {
      res.status(HttpStatus.NO_CONTENT);
      return;
    }
    return { success: true, data };
  }

  @Delete(':id/location')
  @RequirePermission('technicians', 'edit')
  @ApiOperation({
    summary: 'Go offline (clear live location)',
    description:
      '**Guard:** `technicians.edit` and self. Removes the live location immediately — ' +
      'the phone calls this on sign-out, rather than leaving the last fix to expire.',
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
      'dispatch map’s live layer; absent technicians fall back to their derived position. ' +
      'Only technicians whose card has **Track location** on (and who are not ' +
      'subcontractors) are listed, even when a fix of theirs still sits in the store.',
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
