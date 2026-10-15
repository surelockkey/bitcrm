import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { TechniciansService } from './technicians.service';
import { UpdateTechnicianDto } from './dto/update-technician.dto';
import { ListTechniciansQueryDto } from './dto/list-technicians-query.dto';

@ApiTags('Technicians')
@ApiBearerAuth()
@Controller('technicians')
export class TechniciansController {
  constructor(private readonly techniciansService: TechniciansService) {}

  @Get()
  @RequirePermission('technicians', 'view')
  @ApiOperation({
    summary: 'List technicians',
    description:
      '**Guard:** `technicians.view` permission required. Manager+ only (field technicians are denied). ' +
      'Supports `status` filter and cursor pagination.',
  })
  async list(@Query() query: ListTechniciansQueryDto, @CurrentUser() user: JwtUser) {
    return this.techniciansService.list(query, user);
  }

  // Before any `:id` route, or the parameter swallows it.
  @Get('count')
  @RequirePermission('technicians', 'view')
  @ApiOperation({
    summary: 'How many technicians the list holds',
    description:
      '**Guard:** `technicians.view` permission required. Manager+ only, exactly as the list — ' +
      'a field technician is denied here too. Takes the same `status` filter and answers ' +
      '`{ total, atLeast }`, the row count behind "Page 2 of 7". Cached for thirty seconds.',
  })
  async count(@Query() query: ListTechniciansQueryDto, @CurrentUser() user: JwtUser) {
    const data = await this.techniciansService.count(query, user);
    return { success: true, data };
  }

  @Get(':id/profile')
  @RequirePermission('technicians', 'view')
  @ApiOperation({
    summary: 'Get a technician profile',
    description:
      '**Guard:** `technicians.view` permission required. Manager+ or self — ' +
      'a technician may only read their own profile.\n\n' +
      '`gpsTrackingEnabled` is served as it applies, not as the checkbox was stored: ' +
      'the card’s **Track location**, and never `true` for a subcontractor. The phone ' +
      'reads its own profile here to decide whether to post `POST /technicians/:id/location` ' +
      'at all; a fix posted while it is `false` is accepted and dropped.',
  })
  async getProfile(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const data = await this.techniciansService.getProfile(id, user);
    return { success: true, data };
  }

  @Put(':id/profile')
  @RequirePermission('technicians', 'edit')
  @ApiOperation({
    summary: 'Update a technician profile',
    description:
      '**Guard:** `technicians.edit` permission required. ' +
      'Self (technician) may set profile fields (phone, additional phones, home address). ' +
      'Operational fields (user type, labor cost, status, call masking, GPS, mobile app) require Manager+. ' +
      'Publishes a `tech.updated` event.',
  })
  async updateProfile(
    @Param('id') id: string,
    @Body() dto: UpdateTechnicianDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.techniciansService.updateProfile(id, dto, user);
    return { success: true, data };
  }

  @Get(':id/onboarding-status')
  @RequirePermission('technicians', 'view')
  @ApiOperation({
    summary: 'Get technician onboarding status',
    description:
      '**Guard:** `technicians.view` permission required. Manager+ or self. ' +
      'Returns the onboarding checklist (profile / skills / commission) and completion count.',
  })
  async getOnboardingStatus(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.techniciansService.getOnboardingStatus(id, user);
    return { success: true, data };
  }
}
