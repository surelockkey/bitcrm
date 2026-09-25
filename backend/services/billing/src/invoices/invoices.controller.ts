import {
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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@bitcrm/shared';
import type { Caller } from '../common/access';
import { CallerCtx } from '../common/caller.decorator';
import { Internal } from '../common/decorators/internal.decorator';
import { MarkSentDto } from '../common/dto/sent.dto';
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
    summary: "Create the job's invoice",
    description:
      '**Guard:** `invoices.create`. One per job: id and number are the job’s. 422 when the job has no items, 409 when it already has an invoice.',
  })
  async create(@Body() dto: CreateInvoiceDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.invoices.create(dto.dealId, caller) };
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
  @ApiOperation({ summary: 'Get invoice', description: "**Guard:** `invoices.view`. Items/tax are the job's, live." })
  async get(@Param('id') id: string, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.invoices.get(id, caller) };
  }

  @Patch(':id')
  @RequirePermission('invoices', 'edit')
  @ApiOperation({ summary: 'Update invoice fields', description: '**Guard:** `invoices.edit`.' })
  async update(@Param('id') id: string, @Body() dto: UpdateInvoiceDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.invoices.update(id, dto, caller) };
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
