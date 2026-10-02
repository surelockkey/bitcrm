import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@bitcrm/shared';
import { Internal } from '../common/decorators/internal.decorator';
import { ItemGroupsService } from './item-groups.service';

const SHAPE =
  ' A group is `{ id, name, description, total, members, externalId? }`; a member is ' +
  '`{ productId, name, quantity, priceClient, taxable, description, customAttributes }` — ' +
  'the line "Add group" puts on a job (costs come from the price book, never from here). ' +
  '`total` = Σ quantity × priceClient. A Workiz member whose item has no product here is left out.';

/**
 * Item groups (Workiz "item groups", `separate_items`): sets of price-book
 * items added to a job in one go. They sit in the price book, so the item
 * guard reads them. Written by the Workiz import; no write routes yet.
 */
@ApiTags('Item groups')
@ApiBearerAuth()
@Controller('item-groups')
export class ItemGroupsController {
  constructor(private readonly service: ItemGroupsService) {}

  @Get()
  @RequirePermission('products', 'view')
  @ApiOperation({
    summary: 'List the item groups',
    description: '**Guard:** `products.view`. By name.' + SHAPE,
  })
  async list() {
    const data = await this.service.list();
    return { success: true, data };
  }

  @Get('internal/:id')
  @Internal()
  @ApiOperation({
    summary: 'Internal: get an item group (for deal-service "Add group")',
    description: '**Guard:** Internal (X-Internal-Secret header required). Service-to-service only.',
  })
  async findByIdInternal(@Param('id') id: string) {
    const data = await this.service.findById(id);
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('products', 'view')
  @ApiOperation({
    summary: 'Get an item group',
    description: '**Guard:** `products.view`. 404 when there is no such group.' + SHAPE,
  })
  async findById(@Param('id') id: string) {
    const data = await this.service.findById(id);
    return { success: true, data };
  }
}
