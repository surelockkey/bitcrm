import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { TransfersService } from './transfers.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { DeductStockDto } from './dto/deduct-stock.dto';
import { RestoreStockDto } from './dto/restore-stock.dto';
import { ListTransfersQueryDto } from './dto/list-transfers-query.dto';
import { Internal } from '../common/decorators/internal.decorator';

@ApiTags('Transfers')
@ApiBearerAuth()
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Post()
  @RequirePermission('transfers', 'create')
  @ApiOperation({ summary: 'Create a transfer between locations', description: '**Guard:** `transfers.create` permission required.' })
  async create(@Body() dto: CreateTransferDto, @CurrentUser() user: JwtUser) {
    const data = await this.transfersService.createTransfer(dto, user);
    return { success: true, data };
  }

  @Get()
  @RequirePermission('transfers', 'view')
  @ApiOperation({ summary: 'List all transfers', description: '**Guard:** `transfers.view` permission required.' })
  async list(@Query() query: ListTransfersQueryDto) {
    const { items, nextCursor } = await this.transfersService.list(query);
    return {
      success: true,
      data: items,
      pagination: { nextCursor, count: items.length },
    };
  }

  @Get(':id')
  @RequirePermission('transfers', 'view')
  @ApiOperation({ summary: 'Get transfer by ID', description: '**Guard:** `transfers.view` permission required.' })
  async findById(@Param('id') id: string) {
    const data = await this.transfersService.findById(id);
    return { success: true, data };
  }

  @Get('entity/:type/:id')
  @RequirePermission('transfers', 'view')
  @ApiOperation({ summary: 'List transfers for a specific warehouse/container', description: '**Guard:** `transfers.view` permission required.' })
  async findByEntity(
    @Param('type') type: string,
    @Param('id') id: string,
    @Query() query: ListTransfersQueryDto,
  ) {
    const { items, nextCursor } = await this.transfersService.findByEntity(
      type,
      id,
      query.limit || 20,
      query.cursor,
    );
    return {
      success: true,
      data: items,
      pagination: { nextCursor, count: items.length },
    };
  }

  @Post('internal/stock/deduct')
  @Internal()
  @ApiOperation({ summary: 'Internal: deduct stock from container (for deal service)', description: '**Guard:** Internal (X-Internal-Secret header required). Service-to-service only.' })
  async deductStock(@Body() dto: DeductStockDto) {
    await this.transfersService.deductStock(dto);
    return { success: true };
  }

  @Post('internal/stock/restore')
  @Internal()
  @ApiOperation({ summary: 'Internal: restore stock to container (for deal service)', description: '**Guard:** Internal (X-Internal-Secret header required). Service-to-service only.' })
  async restoreStock(@Body() dto: RestoreStockDto) {
    await this.transfersService.restoreStock(dto);
    return { success: true };
  }
}
