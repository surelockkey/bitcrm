import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RequirePermission, CurrentUser } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { BrandsService } from './brands.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

@ApiTags('Brands')
@ApiBearerAuth()
@Controller('brands')
export class BrandsController {
  constructor(private readonly service: BrandsService) {}

  @Post()
  @RequirePermission('brands', 'create')
  @ApiOperation({
    summary: 'Create a brand',
    description: '**Guard:** `brands.create`. Rejected (409) if the name is taken.',
  })
  async create(@Body() dto: CreateBrandDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.create(dto, user);
    return { success: true, data };
  }

  @Get()
  @RequirePermission('brands', 'view')
  @ApiOperation({
    summary: 'List all brands',
    description: '**Guard:** `brands.view`. Includes archived; filter on `active` for pickers.',
  })
  async list() {
    const data = await this.service.list();
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('brands', 'view')
  @ApiOperation({ summary: 'Get a brand by id', description: '**Guard:** `brands.view`.' })
  async findById(@Param('id') id: string) {
    const data = await this.service.findById(id);
    return { success: true, data };
  }

  @Put(':id')
  @RequirePermission('brands', 'edit')
  @ApiOperation({
    summary: 'Update a brand',
    description: '**Guard:** `brands.edit`. Renaming re-checks name uniqueness (409).',
  })
  async update(@Param('id') id: string, @Body() dto: UpdateBrandDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.update(id, dto, user);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('brands', 'delete')
  @ApiOperation({
    summary: 'Delete a brand',
    description: '**Guard:** `brands.delete`. Items do not store brands yet, so this always deletes.',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const { archived } = await this.service.remove(id, user);
    return { success: true, data: { id, archived, deleted: !archived } };
  }
}
