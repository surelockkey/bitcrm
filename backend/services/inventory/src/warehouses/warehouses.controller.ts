import {
  Body,
  Controller,
  Delete,
  Get,
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
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { ListWarehousesQueryDto } from './dto/list-warehouses-query.dto';

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
  @ApiOperation({ summary: 'List warehouses', description: '**Guard:** `warehouses.view` permission required.' })
  async list(@Query() query: ListWarehousesQueryDto) {
    const { items, nextCursor } = await this.warehousesService.list(query);
    return {
      success: true,
      data: items,
      pagination: { nextCursor, count: items.length },
    };
  }

  @Get(':id')
  @RequirePermission('warehouses', 'view')
  @ApiOperation({ summary: 'Get warehouse by ID', description: '**Guard:** `warehouses.view` permission required.' })
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
  @ApiOperation({ summary: 'Receive stock into warehouse', description: '**Guard:** `warehouses.edit` permission required.' })
  async receiveStock(
    @Param('id') id: string,
    @Body() dto: ReceiveStockDto,
    @CurrentUser() user: JwtUser,
  ) {
    await this.warehousesService.receiveStock(id, dto.items, user);
    return { success: true };
  }
}
