import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@bitcrm/shared';
import type { Caller } from '../common/access';
import { CallerCtx } from '../common/caller.decorator';
import { Internal } from '../common/decorators/internal.decorator';
import { MarkSentDto } from '../common/dto/sent.dto';
import { CreateEstimateDto } from './dto/create-estimate.dto';
import { EstimateItemDto, ItemTaxableDto, ReorderItemsDto } from './dto/estimate-item.dto';
import { SetEstimateStatusDto } from './dto/estimate-status.dto';
import { ListEstimatesQueryDto } from './dto/list-estimates-query.dto';
import { UpdateEstimateDto } from './dto/update-estimate.dto';
import { EstimatesService } from './estimates.service';

const truthy = (v?: string) => v === '1' || v === 'true';

@ApiTags('Estimates')
@ApiBearerAuth()
@Controller('estimates')
export class EstimatesController {
  constructor(private readonly estimates: EstimatesService) {}

  @Post()
  @RequirePermission('estimates', 'create')
  @ApiOperation({
    summary: 'Create an estimate for a job',
    description: "**Guard:** `estimates.create`. Number `<jobNumber>-<n>`; tax/discount start as the job's; `copyJobItems` copies the job's lines.",
  })
  async create(@Body() dto: CreateEstimateDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.estimates.create(dto, caller) };
  }

  @Get()
  @RequirePermission('estimates', 'view')
  @ApiOperation({ summary: 'List estimates', description: '**Guard:** `estimates.view`.' })
  async list(@Query() query: ListEstimatesQueryDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.estimates.list(query, caller) };
  }

  @Get('summary')
  @RequirePermission('estimates', 'view')
  @ApiOperation({ summary: 'Estimate counts/amounts by status', description: '**Guard:** `estimates.view`.' })
  async summary(@CallerCtx() caller: Caller) {
    return { success: true, data: await this.estimates.summary(caller) };
  }

  @Get('by-deal/:dealId')
  @RequirePermission('estimates', 'view')
  @ApiOperation({ summary: "A job's estimates with items", description: '**Guard:** `estimates.view`.' })
  async byDeal(@Param('dealId') dealId: string, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.estimates.listByDeal(dealId, caller) };
  }

  @Get('internal/:id')
  @Internal()
  @ApiOperation({
    summary: 'Get estimate (internal)',
    description: '**Guard:** Internal service-to-service only (`x-internal-secret` header required).',
  })
  async getInternal(@Param('id') id: string) {
    const data = await this.estimates.getStored(id);
    if (!data) throw new NotFoundException('Estimate not found');
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('estimates', 'view')
  @ApiOperation({ summary: 'Get estimate with items', description: '**Guard:** `estimates.view`.' })
  async get(@Param('id') id: string, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.estimates.get(id, caller) };
  }

  @Patch(':id')
  @RequirePermission('estimates', 'edit')
  @ApiOperation({
    summary: 'Update estimate fields / tax / discount',
    description: '**Guard:** `estimates.edit`. `taxRateId` resolves the name + effective percent (source `manual`); `null` clears it.',
  })
  async update(@Param('id') id: string, @Body() dto: UpdateEstimateDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.estimates.update(id, dto, caller) };
  }

  @Patch(':id/status')
  @RequirePermission('estimates', 'edit')
  @ApiOperation({ summary: 'Set status by hand', description: '**Guard:** `estimates.edit`.' })
  async setStatus(@Param('id') id: string, @Body() dto: SetEstimateStatusDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.estimates.setStatus(id, dto.status, caller) };
  }

  @Post(':id/items')
  @RequirePermission('estimates', 'edit')
  @ApiOperation({ summary: 'Add a line', description: '**Guard:** `estimates.edit`.' })
  async addItem(@Param('id') id: string, @Body() dto: EstimateItemDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.estimates.addItem(id, dto, caller) };
  }

  @Put(':id/items-order')
  @RequirePermission('estimates', 'edit')
  @ApiOperation({ summary: 'Reorder lines', description: '**Guard:** `estimates.edit`.' })
  async reorder(@Param('id') id: string, @Body() dto: ReorderItemsDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.estimates.reorderItems(id, dto.lineIds, caller) };
  }

  @Put(':id/items/:lineId')
  @RequirePermission('estimates', 'edit')
  @ApiOperation({ summary: 'Replace a line', description: '**Guard:** `estimates.edit`.' })
  async updateItem(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: EstimateItemDto,
    @CallerCtx() caller: Caller,
  ) {
    return { success: true, data: await this.estimates.updateItem(id, lineId, dto, caller) };
  }

  @Patch(':id/items/:lineId/taxable')
  @RequirePermission('estimates', 'edit')
  @ApiOperation({ summary: 'Toggle a line’s taxable flag', description: '**Guard:** `estimates.edit`.' })
  async setTaxable(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: ItemTaxableDto,
    @CallerCtx() caller: Caller,
  ) {
    return { success: true, data: await this.estimates.setItemTaxable(id, lineId, dto.taxable, caller) };
  }

  @Delete(':id/items/:lineId')
  @RequirePermission('estimates', 'edit')
  @ApiOperation({ summary: 'Remove a line', description: '**Guard:** `estimates.edit`.' })
  async removeItem(@Param('id') id: string, @Param('lineId') lineId: string, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.estimates.removeItem(id, lineId, caller) };
  }

  @Post(':id/duplicate')
  @RequirePermission('estimates', 'create')
  @ApiOperation({ summary: 'Duplicate (new number, unsent)', description: '**Guard:** `estimates.create`.' })
  async duplicate(@Param('id') id: string, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.estimates.duplicate(id, caller) };
  }

  @Post(':id/sync-to-job')
  @RequirePermission('estimates', 'sync')
  @HttpCode(200)
  @ApiOperation({
    summary: "Overwrite the job's items with this estimate",
    description: '**Guard:** `estimates.sync`. Needs ≥ 1 item; refused for archived estimates. Marks the estimate won.',
  })
  async sync(@Param('id') id: string, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.estimates.syncToJob(id, caller) };
  }

  @Post(':id/mark-sent')
  @RequirePermission('estimates', 'send')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark sent / unsent', description: '**Guard:** `estimates.send`. Sending an unsent estimate makes it pending.' })
  async markSent(@Param('id') id: string, @Body() dto: MarkSentDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.estimates.markSent(id, dto.sent, caller) };
  }

  @Delete(':id')
  @RequirePermission('estimates', 'delete')
  @ApiOperation({ summary: 'Delete estimate', description: '**Guard:** `estimates.delete`.' })
  async delete(@Param('id') id: string, @CallerCtx() caller: Caller) {
    await this.estimates.delete(id, caller);
    return { success: true, data: { deleted: true } };
  }

  @Get(':id/pdf')
  @RequirePermission('estimates', 'view')
  @ApiOperation({ summary: 'Estimate PDF URL', description: '**Guard:** `estimates.view`. `?download=1` sets an attachment filename.' })
  async pdf(@Param('id') id: string, @Query('download') download: string | undefined, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.estimates.pdf(id, truthy(download), caller) };
  }

  @Get(':id/html')
  @RequirePermission('estimates', 'view')
  @ApiOperation({ summary: 'Estimate HTML preview', description: '**Guard:** `estimates.view`.' })
  async html(@Param('id') id: string, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.estimates.html(id, caller) };
  }
}
