import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RequirePermission, CurrentUser } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { ItemCategoriesService } from './item-categories.service';
import { CreateItemCategoryDto } from './dto/create-item-category.dto';
import { UpdateItemCategoryDto } from './dto/update-item-category.dto';

@ApiTags('Item Categories')
@ApiBearerAuth()
@Controller('categories')
export class ItemCategoriesController {
  constructor(private readonly service: ItemCategoriesService) {}

  @Post()
  @RequirePermission('product_categories', 'create')
  @ApiOperation({
    summary: 'Create an item category',
    description: '**Guard:** `product_categories.create`. Rejected (409) if the name is taken.',
  })
  async create(@Body() dto: CreateItemCategoryDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.create(dto, user);
    return { success: true, data };
  }

  @Get()
  @RequirePermission('product_categories', 'view')
  @ApiOperation({
    summary: 'List all item categories',
    description: '**Guard:** `product_categories.view`. Includes archived; filter on `active` for pickers.',
  })
  async list() {
    const data = await this.service.list();
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('product_categories', 'view')
  @ApiOperation({ summary: 'Get an item category by id', description: '**Guard:** `product_categories.view`.' })
  async findById(@Param('id') id: string) {
    const data = await this.service.findById(id);
    return { success: true, data };
  }

  @Put(':id')
  @RequirePermission('product_categories', 'edit')
  @ApiOperation({
    summary: 'Update an item category',
    description: '**Guard:** `product_categories.edit`. Renaming re-checks name uniqueness (409).',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateItemCategoryDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.update(id, dto, user);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('product_categories', 'delete')
  @ApiOperation({
    summary: 'Delete or archive an item category',
    description:
      '**Guard:** `product_categories.delete`. Categories still used by an item are archived ' +
      '(`active: false`) instead of deleted. The response says which happened.',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const { archived } = await this.service.remove(id, user);
    return { success: true, data: { id, archived, deleted: !archived } };
  }
}
