import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { WarehousesService } from './warehouses.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { ReceiveWarehouseStockDto } from './dto/receive-stock.dto';
import { ListWarehousesQueryDto } from './dto/list-warehouses-query.dto';
import { Internal } from '../common/decorators/internal.decorator';
import { coerceInternalLimit } from '../common/utils/internal-pagination';

@ApiTags('Warehouses')
@ApiBearerAuth()
@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly warehousesService: WarehousesService) {}

  @Post()
  @RequirePermission('warehouses', 'create')
  @ApiOperation({ summary: 'Create a warehouse', description: '**Guard:** `warehouses.create` permission required.' })
  async create(@Body() dto: CreateWarehouseDto) {
    const data = await this.warehousesService.create(dto);
    return { success: true, data };
  }

  @Get()
  @RequirePermission('warehouses', 'view')
  @ApiOperation({
    summary: 'List warehouses',
    description:
      '**Guard:** `warehouses.view` permission required. Workiz placeholders (`placeholder: true`, ' +
      'locations deleted in Workiz) are never listed or counted; `GET /warehouses/:id` still reads them. ' +
      'A page is never longer than `limit`. Each row carries `totalUnits` (units across its stock rows) and `uniqueItems` (products with quantity > 0), kept by every stock write — absent on a row `backfill:location-totals` has not reached yet.',
  })
  async list(@Query() query: ListWarehousesQueryDto) {
    const { items, nextCursor } = await this.warehousesService.list(query);
    return {
      success: true,
      data: items,
      pagination: { nextCursor, count: items.length },
    };
  }

  // Before `:id`, or the parameter route swallows it.
  @Get('count')
  @RequirePermission('warehouses', 'view')
  @ApiOperation({
    summary: 'How many warehouses the list holds',
    description:
      '**Guard:** `warehouses.view` permission required. Takes the same filters the list does ' +
      '(`search`, `status`; `cursor` and `limit` are ignored) and answers `{ total, atLeast }` — ' +
      'the row count behind "Page 2 of 7". `atLeast` means the walk stopped on a ceiling, ' +
      'which the panel renders as `7+`. Cached for thirty seconds.',
  })
  async count(@Query() query: ListWarehousesQueryDto) {
    const data = await this.warehousesService.count(query);
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('warehouses', 'view')
  @ApiOperation({
    summary: 'Get warehouse by ID',
    description:
      '**Guard:** `warehouses.view` permission required. Carries `totalUnits` / `uniqueItems` as the ' +
      'list does (absent until backfilled).',
  })
  async findById(@Param('id') id: string) {
    const data = await this.warehousesService.findById(id);
    return { success: true, data };
  }

  @Put(':id')
  @RequirePermission('warehouses', 'edit')
  @ApiOperation({ summary: 'Update a warehouse', description: '**Guard:** `warehouses.edit` permission required.' })
  async update(@Param('id') id: string, @Body() dto: UpdateWarehouseDto) {
    const data = await this.warehousesService.update(id, dto);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('warehouses', 'delete')
  @ApiOperation({ summary: 'Archive a warehouse', description: '**Guard:** `warehouses.delete` permission required.' })
  async archive(@Param('id') id: string) {
    const data = await this.warehousesService.archive(id);
    return { success: true, data };
  }

  @Get(':id/stock')
  @RequirePermission('warehouses', 'view')
  @ApiOperation({ summary: 'Get stock levels in warehouse', description: '**Guard:** `warehouses.view` permission required.' })
  async getStock(@Param('id') id: string) {
    const data = await this.warehousesService.getStock(id);
    return { success: true, data };
  }

  @Post(':id/receive')
  @RequirePermission('warehouses', 'edit')
  @ApiOperation({
    summary: 'Receive stock into warehouse',
    description:
      '**Guard:** `warehouses.edit` permission required. The same rules as `POST /transfers/receive` ' +
      '(404 unknown warehouse, services rejected, non-stock-managed items dropped into ' +
      '`skippedItems`, none left is a 400). Answers the RECEIVE transfer.',
  })
  async receiveStock(
    @Param('id') id: string,
    @Body() dto: ReceiveWarehouseStockDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.warehousesService.receiveStock(id, dto.items, user);
    return { success: true, data };
  }

  @Get('internal/all')
  @Internal()
  @ApiOperation({ summary: 'Internal: list all warehouses (for search indexer)', description: '**Guard:** Internal (X-Internal-Secret header required). Service-to-service only.' })
  async listAllInternal(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const data = await this.warehousesService.findAll(
      coerceInternalLimit(limit),
      cursor,
    );
    return { success: true, data };
  }

  @Get('internal/:id')
  @Internal()
  @ApiOperation({ summary: 'Internal: get warehouse by ID (for search indexer)', description: '**Guard:** Internal (X-Internal-Secret header required). Service-to-service only.' })
  async findByIdInternal(@Param('id') id: string) {
    const data = await this.warehousesService.findById(id);
    if (!data) {
      throw new NotFoundException(`Warehouse "${id}" not found`);
    }
    return { success: true, data };
  }
}
