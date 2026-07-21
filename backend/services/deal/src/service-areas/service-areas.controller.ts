import {
  Controller, Get, Post, Put, Delete, Body, Param,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RequirePermission, CurrentUser } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { ServiceAreasService } from './service-areas.service';
import { CreateServiceAreaDto } from './dto/create-service-area.dto';
import { UpdateServiceAreaDto } from './dto/update-service-area.dto';
import { PreviewServiceAreaDto } from './dto/preview-service-area.dto';
import { ResolveServiceAreaDto } from './dto/resolve-service-area.dto';
import { Internal } from '../common/decorators/internal.decorator';

@ApiTags('Service Areas')
@ApiBearerAuth()
@Controller('service-areas')
export class ServiceAreasController {
  constructor(private readonly service: ServiceAreasService) {}

  @Post()
  @RequirePermission('service_areas', 'create')
  @ApiOperation({
    summary: 'Create a service area',
    description: '**Guard:** `service_areas.create`. Rejected (409) if it overlaps an existing active area.',
  })
  async create(@Body() dto: CreateServiceAreaDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.create(dto, user);
    return { success: true, data };
  }

  @Get()
  @RequirePermission('service_areas', 'view')
  @ApiOperation({
    summary: 'List all service areas',
    description: '**Guard:** `service_areas.view`.',
  })
  async list() {
    const data = await this.service.list();
    return { success: true, data };
  }

  @Post('preview')
  @RequirePermission('service_areas', 'view')
  @ApiOperation({
    summary: 'Preview derived coverage for an unsaved definition',
    description: '**Guard:** `service_areas.view`. Geocodes ZIPs and returns coverage shapes for the map.',
  })
  async preview(@Body() dto: PreviewServiceAreaDto) {
    const data = await this.service.preview(dto);
    return { success: true, data };
  }

  @Post('resolve')
  @RequirePermission('service_areas', 'view')
  @ApiOperation({
    summary: 'Resolve which service area contains a location',
    description: '**Guard:** `service_areas.view`. Accepts lat/lng or an address; returns the one containing area or null.',
  })
  async resolve(@Body() dto: ResolveServiceAreaDto) {
    const data = await this.service.resolve(dto);
    return { success: true, data };
  }

  @Get('internal')
  @Internal()
  @ApiOperation({
    summary: 'Internal: list service areas for the user-service technician linkage',
    description: '**Guard:** internal secret (`x-internal-secret`).',
  })
  async listInternal() {
    const areas = await this.service.list();
    return {
      success: true,
      data: areas.map((a) => ({ id: a.id, name: a.name, active: a.active })),
    };
  }

  @Get(':id')
  @RequirePermission('service_areas', 'view')
  @ApiOperation({
    summary: 'Get a service area by id',
    description: '**Guard:** `service_areas.view`.',
  })
  async findById(@Param('id') id: string) {
    const data = await this.service.findById(id);
    return { success: true, data };
  }

  @Put(':id')
  @RequirePermission('service_areas', 'edit')
  @ApiOperation({
    summary: 'Update a service area',
    description: '**Guard:** `service_areas.edit`. Geometry recomputed only when type/zips/vertices are supplied. Overlap re-checked.',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateServiceAreaDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.update(id, dto, user);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('service_areas', 'delete')
  @ApiOperation({
    summary: 'Delete a service area',
    description: '**Guard:** `service_areas.delete`.',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    await this.service.remove(id, user);
    return { success: true, data: { id, deleted: true } };
  }
}
