import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
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
import { EstimateItemDto, ItemTaxableDto, ReorderItemsDto } from '../estimates/dto/estimate-item.dto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { ListInvoicesQueryDto } from './dto/list-invoices-query.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { InvoicesService } from './invoices.service';

const truthy = (v?: string) => v === '1' || v === 'true';

@ApiTags('Invoices')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Post()
  @RequirePermission('invoices', 'create')
  @ApiOperation({
    summary: "Create the job's invoice, or a client's invoice with no job",
    description:
      '**Guard:** `invoices.create`. With `dealId`: one per job, id and number are the job’s; 422 when the job ' +
      'has no items, 409 when it already has an invoice. With only `contactId` (Workiz: the client card’s ' +
      'Create new → Invoice): a client invoice with no job — fresh id, number from the account counter, due ' +
      'date from the client’s payment terms, no lines yet (add them with `POST :id/items`); office-only ' +
      '(403 under `assigned_only`). One of the two is required.',
  })
  async create(@Body() dto: CreateInvoiceDto, @CallerCtx() caller: Caller) {
    if (dto.dealId) return { success: true, data: await this.invoices.create(dto.dealId, caller) };
    if (dto.contactId) return { success: true, data: await this.invoices.createForClient(dto.contactId, caller) };
    throw new BadRequestException('An invoice needs a job (dealId) or a client (contactId)');
  }

  @Get()
  @RequirePermission('invoices', 'view')
  @ApiOperation({
    summary: 'List invoices',
    description: '**Guard:** `invoices.view`. Newest first; `assigned_only` scope limits to the caller’s jobs.',
  })
  async list(@Query() query: ListInvoicesQueryDto, @CallerCtx() caller: Caller) {
    const data = await this.invoices.list(query, caller);
    return { success: true, data };
  }

  @Get('count')
  @RequirePermission('invoices', 'view')
  @ApiOperation({
    summary: 'How many invoices the list holds',
    description:
      '**Guard:** `invoices.view`. Takes the same filters as the list (`contactId`, `dealId`, ' +
      '`status`, `from`/`to`, `unsent`; `cursor` and `limit` are ignored) and answers ' +
      '`{ total, atLeast }` — the row count behind "Page 2 of 7". Under the `assigned_only` ' +
      'scope `total` is `null`: that page is filtered after the query, so no index walk ' +
      'answers it and the panel drops the "of N". Cached for thirty seconds.',
  })
  async count(@Query() query: ListInvoicesQueryDto, @CallerCtx() caller: Caller) {
    const data = await this.invoices.count(query, caller);
    return { success: true, data };
  }

  @Get('summary')
  @RequirePermission('invoices', 'view')
  @ApiOperation({ summary: 'Invoice totals by status', description: '**Guard:** `invoices.view`.' })
  async summary(@CallerCtx() caller: Caller, @Headers('authorization') authorization?: string) {
    return { success: true, data: await this.invoices.summary(caller, authorization) };
  }

  @Get('needing-invoice')
  @RequirePermission('invoices', 'view')
  @ApiOperation({
    summary: 'Jobs with items and no invoice',
    description: '**Guard:** `invoices.view` (the job list also applies the caller’s `deals` scope).',
  })
  async needingInvoice(@Headers('authorization') authorization?: string) {
    return { success: true, data: await this.invoices.needingInvoice(authorization) };
  }

  @Get('by-deal/:dealId')
  @RequirePermission('invoices', 'view')
  @ApiOperation({ summary: "A job's invoice (or null)", description: '**Guard:** `invoices.view`.' })
  async byDeal(@Param('dealId') dealId: string, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.invoices.getByDeal(dealId, caller) };
  }

  @Get('internal/:id')
  @Internal()
  @ApiOperation({
    summary: 'Get invoice (internal)',
    description: '**Guard:** Internal service-to-service only (`x-internal-secret` header required). Stored row, no live items.',
  })
  async getInternal(@Param('id') id: string) {
    const data = await this.invoices.getStored(id);
    if (!data) throw new NotFoundException('Invoice not found');
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('invoices', 'view')
  @ApiOperation({
    summary: 'Get invoice',
    description: "**Guard:** `invoices.view`. A job invoice's items/tax are the job's, live; a client invoice's are its own rows.",
  })
  async get(@Param('id') id: string, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.invoices.get(id, caller) };
  }

  @Patch(':id')
  @RequirePermission('invoices', 'edit')
  @ApiOperation({
    summary: 'Update invoice fields',
    description:
      '**Guard:** `invoices.edit`. `taxRateId` / `discount` apply to a client invoice only (422 on a job invoice, whose tax and discount are the job’s).',
  })
  async update(@Param('id') id: string, @Body() dto: UpdateInvoiceDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.invoices.update(id, dto, caller) };
  }

  // ---- lines of a CLIENT invoice (a job invoice's lines are the job's items: 422)

  @Post(':id/items')
  @RequirePermission('invoices', 'edit')
  @ApiOperation({ summary: 'Add a line (client invoice)', description: '**Guard:** `invoices.edit`. 422 on a job invoice.' })
  async addItem(@Param('id') id: string, @Body() dto: EstimateItemDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.invoices.addItem(id, dto, caller) };
  }

  @Put(':id/items-order')
  @RequirePermission('invoices', 'edit')
  @ApiOperation({ summary: 'Reorder lines (client invoice)', description: '**Guard:** `invoices.edit`. 422 on a job invoice.' })
  async reorder(@Param('id') id: string, @Body() dto: ReorderItemsDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.invoices.reorderItems(id, dto.lineIds, caller) };
  }

  @Put(':id/items/:lineId')
  @RequirePermission('invoices', 'edit')
  @ApiOperation({ summary: 'Replace a line (client invoice)', description: '**Guard:** `invoices.edit`. 422 on a job invoice.' })
  async updateItem(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: EstimateItemDto,
    @CallerCtx() caller: Caller,
  ) {
    return { success: true, data: await this.invoices.updateItem(id, lineId, dto, caller) };
  }

  @Patch(':id/items/:lineId/taxable')
  @RequirePermission('invoices', 'edit')
  @ApiOperation({ summary: 'Toggle a line’s taxable flag (client invoice)', description: '**Guard:** `invoices.edit`. 422 on a job invoice.' })
  async setTaxable(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: ItemTaxableDto,
    @CallerCtx() caller: Caller,
  ) {
    return { success: true, data: await this.invoices.setItemTaxable(id, lineId, dto.taxable, caller) };
  }

  @Delete(':id/items/:lineId')
  @RequirePermission('invoices', 'edit')
  @ApiOperation({ summary: 'Remove a line (client invoice)', description: '**Guard:** `invoices.edit`. 422 on a job invoice.' })
  async removeItem(@Param('id') id: string, @Param('lineId') lineId: string, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.invoices.removeItem(id, lineId, caller) };
  }

  @Post(':id/mark-sent')
  @RequirePermission('invoices', 'send')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark sent / unsent', description: '**Guard:** `invoices.send`.' })
  async markSent(@Param('id') id: string, @Body() dto: MarkSentDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.invoices.markSent(id, dto.sent, caller) };
  }

  @Delete(':id')
  @RequirePermission('invoices', 'delete')
  @ApiOperation({ summary: 'Delete invoice', description: '**Guard:** `invoices.delete`. Clears the job link.' })
  async delete(@Param('id') id: string, @CallerCtx() caller: Caller) {
    await this.invoices.delete(id, caller);
    return { success: true, data: { deleted: true } };
  }

  @Get(':id/pdf')
  @RequirePermission('invoices', 'view')
  @ApiOperation({
    summary: 'Invoice PDF URL',
    description: '**Guard:** `invoices.view`. Presigned (5 min); `?download=1` sets an attachment filename. 503 when no browser is available.',
  })
  async pdf(@Param('id') id: string, @Query('download') download: string | undefined, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.invoices.pdf(id, truthy(download), caller) };
  }

  @Get(':id/html')
  @RequirePermission('invoices', 'view')
  @ApiOperation({ summary: 'Invoice HTML preview', description: '**Guard:** `invoices.view`.' })
  async html(@Param('id') id: string, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.invoices.html(id, caller) };
  }
}
