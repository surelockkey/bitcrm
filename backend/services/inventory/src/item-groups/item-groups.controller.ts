import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission, hasPermission } from '@bitcrm/shared';
import { type ItemGroup, type JwtUser } from '@bitcrm/types';
import { Internal } from '../common/decorators/internal.decorator';
import { ItemGroupsService } from './item-groups.service';
import { CreateItemGroupDto } from './dto/create-item-group.dto';
import { UpdateItemGroupDto } from './dto/update-item-group.dto';
import { ListItemGroupsQueryDto } from './dto/list-item-groups-query.dto';

const SHAPE =
  ' A group is `{ id, name, description, groupType, categoryId?, active, total, members, externalId? }`; ' +
  'a member is `{ productId, name, quantity, priceClient, taxable, description, customAttributes, cost? }` — ' +
  'the line "Add group" puts on a job (costs come from the price book, never from here). ' +
  '`total` = Σ quantity × priceClient. `cost` (the group\'s own, Workiz\'s Margin) is left out without ' +
  '`financials.view`. A Workiz member whose item has no product here is left out.';

/** The money rule of the products: a member's cost only for a caller with `financials.view`. */
function forCaller(group: ItemGroup, req: any): ItemGroup {
  if (hasPermission(req?.resolvedPermissions, 'financials', 'view')) return group;
  return { ...group, members: group.members.map(({ cost: _cost, ...member }) => member) };
}

const canSeeCost = (req: any) => ({ canSeeCost: hasPermission(req?.resolvedPermissions, 'financials', 'view') });

/**
 * Item groups (Workiz's Price book → Item groups): sets of price-book items
 * added to a job in one go. They sit in the price book, so the item guards
 * hold: `products.view` to read, `products.create` to make one,
 * `products.edit` to change, disable (`active: false`) or enable one. No
 * delete — a job line keeps naming its group.
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
    description:
      "**Guard:** `products.view`. By name. `status` is Workiz's box: `active`, `disabled` or `all` (default)." + SHAPE,
  })
  async list(@Query() query: ListItemGroupsQueryDto, @Req() req: any) {
    const data = await this.service.list(query.status);
    return { success: true, data: data.map((g) => forCaller(g, req)) };
  }

  @Post()
  @RequirePermission('products', 'create')
  @ApiOperation({
    summary: 'Create an item group (Workiz "Create item group")',
    description:
      '**Guard:** `products.create`. An Individual items group: a name (unique, any case — 409 otherwise), ' +
      'an optional description and category, at least one price-book item with its price, quantity and ' +
      '(with `financials.view`) cost.' + SHAPE,
  })
  async create(@Body() dto: CreateItemGroupDto, @CurrentUser() user: JwtUser, @Req() req: any) {
    const data = await this.service.create(dto, user, canSeeCost(req));
    return { success: true, data: forCaller(data, req) };
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
  async findById(@Param('id') id: string, @Req() req: any) {
    const data = await this.service.findById(id);
    return { success: true, data: forCaller(data, req) };
  }

  @Patch(':id')
  @RequirePermission('products', 'edit')
  @ApiOperation({
    summary: 'Edit, disable or enable an item group (Workiz "Edit item group")',
    description:
      '**Guard:** `products.edit`. Only what is sent changes; `members` is the whole new list, each line ' +
      "keeping the name, description, custom field values and cost it had unless sent. `active: false` " +
      'takes the group out of the pickers (a job line keeps naming it).' + SHAPE,
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateItemGroupDto,
    @CurrentUser() user: JwtUser,
    @Req() req: any,
  ) {
    const data = await this.service.update(id, dto, user, canSeeCost(req));
    return { success: true, data: forCaller(data, req) };
  }
}
