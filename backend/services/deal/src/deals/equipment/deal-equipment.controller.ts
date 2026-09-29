import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { DealEquipmentService } from './deal-equipment.service';
import { CreateEquipmentDto, UpdateEquipmentDto } from './dto/equipment.dto';

/** Equipment installed or serviced on a job. Gated by the `deals` permission, as attachments are. */
@ApiTags('Deal Equipment')
@ApiBearerAuth()
@Controller()
export class DealEquipmentController {
  constructor(private readonly service: DealEquipmentService) {}

  @Get(':id/equipment')
  @RequirePermission('deals', 'view')
  @ApiOperation({ summary: 'List a job’s equipment, oldest first', description: '**Guard:** `deals.view`.' })
  async list(@Param('id') id: string) {
    const data = await this.service.list(id);
    return { success: true, data };
  }

  @Post(':id/equipment')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Add equipment to a job',
    description: '**Guard:** `deals.edit`. Name and model are required; the property address defaults to the job’s.',
  })
  async create(@Param('id') id: string, @Body() dto: CreateEquipmentDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.create(id, dto, user);
    return { success: true, data };
  }

  @Patch(':id/equipment/:equipmentId')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Edit a job’s equipment',
    description: '**Guard:** `deals.edit`. `null` clears an optional field.',
  })
  async update(
    @Param('id') id: string,
    @Param('equipmentId') equipmentId: string,
    @Body() dto: UpdateEquipmentDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.update(id, equipmentId, dto, user);
    return { success: true, data };
  }

  @Delete(':id/equipment/:equipmentId')
  @RequirePermission('deals', 'edit')
  @ApiOperation({ summary: 'Remove equipment from a job', description: '**Guard:** `deals.edit`.' })
  async remove(@Param('id') id: string, @Param('equipmentId') equipmentId: string, @CurrentUser() user: JwtUser) {
    await this.service.delete(id, equipmentId, user);
    return { success: true, data: null };
  }
}
