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
import { WorkOrdersService } from './work-orders.service';
import { CreateWorkOrderDto } from './dto/create-work-order.dto';
import { UpdateWorkOrderDto } from './dto/update-work-order.dto';
import { ListWorkOrdersQueryDto } from './dto/list-work-orders-query.dto';
import { UploadWorkOrderDocumentDto } from './dto/upload-work-order-document.dto';

@ApiTags('Work Orders')
@ApiBearerAuth()
@Controller('work-orders')
export class WorkOrdersController {
  constructor(private readonly service: WorkOrdersService) {}

  @Post()
  @RequirePermission('work_orders', 'create')
  @ApiOperation({ summary: 'Create a work order', description: '**Guard:** `work_orders.create`.' })
  async create(@Body() dto: CreateWorkOrderDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.create(dto, user);
    return { success: true, data };
  }

  @Get()
  @RequirePermission('work_orders', 'view')
  @ApiOperation({ summary: 'List work orders (filter by company/status)', description: '**Guard:** `work_orders.view`.' })
  async list(@Query() query: ListWorkOrdersQueryDto) {
    const data = await this.service.list(query);
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('work_orders', 'view')
  @ApiOperation({ summary: 'Get a work order', description: '**Guard:** `work_orders.view`.' })
  async get(@Param('id') id: string) {
    const data = await this.service.findById(id);
    return { success: true, data };
  }

  @Put(':id')
  @RequirePermission('work_orders', 'edit')
  @ApiOperation({ summary: 'Update a work order', description: '**Guard:** `work_orders.edit`.' })
  async update(@Param('id') id: string, @Body() dto: UpdateWorkOrderDto) {
    const data = await this.service.update(id, dto);
    return { success: true, data };
  }

  @Post(':id/document')
  @RequirePermission('work_orders', 'edit')
  @ApiOperation({
    summary: 'Request a presigned upload URL for the WO document',
    description: '**Guard:** `work_orders.edit`. Returned headers must be replayed on the PUT.',
  })
  async requestDocument(@Param('id') id: string, @Body() dto: UploadWorkOrderDocumentDto) {
    const data = await this.service.requestDocumentUpload(id, dto);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('work_orders', 'delete')
  @ApiOperation({
    summary: 'Delete or archive a work order',
    description: '**Guard:** `work_orders.delete`. Archives instead of deleting when linked to a deal.',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const data = await this.service.remove(id, user);
    return { success: true, data };
  }
}
