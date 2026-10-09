import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RequirePermission, CurrentUser } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { CallDevicesService } from './call-devices.service';
import { CreateCallDeviceDto, UpdateCallDeviceDto } from './dto/call-device.dto';

/**
 * Devices are workspace telephony configuration, behind the same `settings`
 * permission as the call groups and flows that ring them.
 */
@ApiTags('Devices')
@ApiBearerAuth()
@Controller('devices')
export class CallDevicesController {
  constructor(private readonly service: CallDevicesService) {}

  @Get()
  @RequirePermission('settings', 'view')
  @ApiOperation({
    summary: 'List devices',
    description:
      '**Guard:** `settings.view`. The desk phones and shop lines (Workiz ' +
      'Devices) a call group or a Forward step can ring, by name.',
  })
  async list() {
    return { success: true, data: await this.service.list() };
  }

  @Get(':id')
  @RequirePermission('settings', 'view')
  @ApiOperation({ summary: 'Get one device', description: '**Guard:** `settings.view`.' })
  async findById(@Param('id') id: string) {
    return { success: true, data: await this.service.findById(id) };
  }

  @Post()
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Add a device',
    description:
      '**Guard:** `settings.edit`. 409 if the name is taken; 400 without a ' +
      'phone number or SIP address, or with one that is not valid.',
  })
  async create(@Body() dto: CreateCallDeviceDto, @CurrentUser() user: JwtUser) {
    return { success: true, data: await this.service.create(dto, user) };
  }

  @Put(':id')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Edit a device',
    description:
      '**Guard:** `settings.edit`. An omitted field keeps its value; `number` ' +
      'or `sipAddress` sent as null is cleared — never both.',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCallDeviceDto,
    @CurrentUser() user: JwtUser,
  ) {
    return { success: true, data: await this.service.update(id, dto, user) };
  }

  @Delete(':id')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Remove a device',
    description:
      '**Guard:** `settings.edit`. Groups that listed it skip it; a flow that ' +
      'forwarded to it falls back to ringing everyone online.',
  })
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
    return { success: true, data: { id, deleted: true } };
  }
}
