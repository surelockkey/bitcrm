import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { ItemAttributesService } from './item-attributes.service';
import { CreateItemAttributeDto } from './dto/create-item-attribute.dto';
import { UpdateItemAttributeDto } from './dto/update-item-attribute.dto';

/**
 * Item custom fields (Workiz "Custom Fields" in the Edit Item popup). The
 * definitions are edited from the item popup itself, so the guards are the
 * item ones: `products.view` to read them, `products.edit` to change them.
 */
@ApiTags('Item custom fields')
@ApiBearerAuth()
@Controller('item-attributes')
export class ItemAttributesController {
  constructor(private readonly service: ItemAttributesService) {}

  @Get()
  @RequirePermission('products', 'view')
  @ApiOperation({
    summary: 'List the item custom fields',
    description:
      '**Guard:** `products.view`. In Workiz order: imported fields by their Workiz id, then ' +
      'the ones made here by creation time. An item keeps its values in ' +
      '`customAttributes`, keyed by the field NAME.',
  })
  async list() {
    const data = await this.service.list();
    return { success: true, data };
  }

  @Post()
  @RequirePermission('products', 'edit')
  @ApiOperation({
    summary: 'Add a custom field',
    description:
      '**Guard:** `products.edit`. `type` is `text` (default), `number` or `quantity`. ' +
      'A name already taken (case-insensitive) is a 409.',
  })
  async create(@Body() dto: CreateItemAttributeDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.create(dto, user);
    return { success: true, data };
  }

  @Patch(':id')
  @RequirePermission('products', 'edit')
  @ApiOperation({
    summary: 'Rename, retype or show/hide a custom field',
    description:
      '**Guard:** `products.edit`. A rename moves the value to the new name on every item ' +
      'that has one (`productsUpdated`); an item already holding a value under the new ' +
      'name keeps it (`productsSkipped`). A name already taken is a 409.',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateItemAttributeDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.update(id, dto, user);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('products', 'edit')
  @ApiOperation({
    summary: 'Delete a custom field',
    description:
      '**Guard:** `products.edit`. Removes the field and its value from every item ' +
      '(`productsUpdated`).',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const result = await this.service.remove(id, user);
    return { success: true, data: { id, deleted: true, ...result } };
  }
}
