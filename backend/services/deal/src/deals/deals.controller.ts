import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RequirePermission, CurrentUser } from '@bitcrm/shared';
import { type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import { DealsService } from './deals.service';
import { CreateDealDto } from './dto/create-deal.dto';
import { UpdateDealDto } from './dto/update-deal.dto';
import { ChangeStageDto } from './dto/change-stage.dto';
import { ListDealsQueryDto } from './dto/list-deals-query.dto';
import { AddNoteDto } from './dto/add-note.dto';
import { AssignTechDto } from './dto/assign-tech.dto';
import { AddDealProductDto } from './dto/add-deal-product.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';
import { Internal } from '../common/decorators/internal.decorator';
import { ResolvedPerms } from '../common/decorators/resolved-permissions.decorator';

@ApiTags('Deals')
@ApiBearerAuth()
@Controller()
export class DealsController {
  constructor(private readonly dealsService: DealsService) {}

  @Post()
  @RequirePermission('deals', 'create')
  @ApiOperation({
    summary: 'Create a new deal',
    description: '**Guard:** `deals.create` permission required.',
  })
  async create(
    @Body() dto: CreateDealDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.dealsService.create(dto, user);
    return { success: true, data };
  }

  @Get()
  @RequirePermission('deals', 'view')
  @ApiOperation({
    summary: 'List deals with filters and pagination',
    description: '**Guard:** `deals.view` permission required. DataScope enforced.',
  })
  async list(
    @Query() query: ListDealsQueryDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms: ResolvedPermissions,
  ) {
    const dataScope = perms?.dataScope?.deals;
    const result = await this.dealsService.list(query, user, dataScope);
    return {
      success: true,
      data: result.items,
      pagination: { nextCursor: result.nextCursor, count: result.items.length },
    };
  }

  @Get(':id')
  @RequirePermission('deals', 'view')
  @ApiOperation({
    summary: 'Get deal by ID',
    description: '**Guard:** `deals.view` permission required.',
  })
  async findById(@Param('id') id: string) {
    const data = await this.dealsService.findById(id);
    return { success: true, data };
  }

  @Put(':id')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Update deal fields',
    description: '**Guard:** `deals.edit` permission required.',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateDealDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.dealsService.update(id, dto, user);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('deals', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a deal',
    description: '**Guard:** `deals.delete` permission required.',
  })
  async softDelete(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    await this.dealsService.softDelete(id, user);
    return { success: true, data: { id, deleted: true } };
  }

  @Put(':id/stage')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Change deal pipeline stage',
    description: '**Guard:** `deals.edit` permission required. Stage transitions validated per role.',
  })
  async changeStage(
    @Param('id') id: string,
    @Body() dto: ChangeStageDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms: ResolvedPermissions,
  ) {
    const transitions = perms?.dealStageTransitions || [];
    const data = await this.dealsService.changeStage(id, dto, user, transitions);
    return { success: true, data };
  }

  @Get(':id/allowed-stages')
  @RequirePermission('deals', 'view')
  @ApiOperation({
    summary: 'Get allowed next stages for current user',
    description: '**Guard:** `deals.view` permission required.',
  })
  async getAllowedStages(
    @Param('id') id: string,
    @ResolvedPerms() perms: ResolvedPermissions,
  ) {
    const transitions = perms?.dealStageTransitions || [];
    const data = await this.dealsService.getAllowedStages(id, transitions);
    return { success: true, data };
  }

  @Get(':id/timeline')
  @RequirePermission('deals', 'view')
  @ApiOperation({
    summary: 'Get deal activity timeline',
    description: '**Guard:** `deals.view` permission required.',
  })
  async getTimeline(
    @Param('id') id: string,
    @Query('limit') limit?: number,
    @Query('cursor') cursor?: string,
  ) {
    const result = await this.dealsService.getTimeline(id, limit || 20, cursor);
    return {
      success: true,
      data: result.items,
      pagination: { nextCursor: result.nextCursor, count: result.items.length },
    };
  }

  @Post(':id/notes')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Add note to deal timeline',
    description: '**Guard:** `deals.edit` permission required.',
  })
  async addNote(
    @Param('id') id: string,
    @Body() dto: AddNoteDto,
    @CurrentUser() user: JwtUser,
  ) {
    await this.dealsService.addNote(id, dto, user);
    return { success: true, data: { added: true } };
  }

  @Get(':id/qualified-techs')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Get qualified technicians for assignment',
    description: '**Guard:** `deals.edit` permission required. Filters by skills and service area.',
  })
  async getQualifiedTechs(@Param('id') id: string) {
    const data = await this.dealsService.getQualifiedTechs(id);
    return { success: true, data };
  }

  @Post(':id/assign')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Assign technician to deal',
    description: '**Guard:** `deals.edit` permission required. Auto-transitions to ASSIGNED if in submitted group.',
  })
  async assignTech(
    @Param('id') id: string,
    @Body() dto: AssignTechDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.dealsService.assignTech(id, dto, user);
    return { success: true, data };
  }

  @Post(':id/unassign')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Remove technician assignment',
    description: '**Guard:** `deals.edit` permission required.',
  })
  async unassignTech(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.dealsService.unassignTech(id, user);
    return { success: true, data };
  }

  @Post(':id/products')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Add product to deal (deducts from tech container)',
    description: '**Guard:** `deals.edit` permission required. Requires assigned technician.',
  })
  async addProduct(
    @Param('id') id: string,
    @Body() dto: AddDealProductDto,
    @CurrentUser() user: JwtUser,
  ) {
    await this.dealsService.addProduct(id, dto, user);
    return { success: true, data: { added: true } };
  }

  @Delete(':id/products/:productId')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Remove product from deal (restores to tech container)',
    description: '**Guard:** `deals.edit` permission required.',
  })
  async removeProduct(
    @Param('id') id: string,
    @Param('productId') productId: string,
    @CurrentUser() user: JwtUser,
  ) {
    await this.dealsService.removeProduct(id, productId, user);
    return { success: true, data: { removed: true } };
  }

  @Get(':id/products')
  @RequirePermission('deals', 'view')
  @ApiOperation({
    summary: 'Get products on deal',
    description: '**Guard:** `deals.view` permission required.',
  })
  async getProducts(@Param('id') id: string) {
    const data = await this.dealsService.getProducts(id);
    return { success: true, data };
  }

  // Internal endpoints (service-to-service)

  @Get('internal/by-tech/:techId')
  @Internal()
  @ApiOperation({
    summary: 'Get deals by technician (internal)',
    description: '**Guard:** Internal service-to-service only (`x-internal-secret` header required).',
  })
  async getTechDeals(@Param('techId') techId: string) {
    const data = await this.dealsService.getTechDeals(techId);
    return { success: true, data: data.items };
  }

  @Put('internal/:id/payment-status')
  @Internal()
  @ApiOperation({
    summary: 'Update payment status (internal)',
    description: '**Guard:** Internal service-to-service only (`x-internal-secret` header required).',
  })
  async updatePaymentStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePaymentStatusDto,
  ) {
    await this.dealsService.updatePaymentStatus(id, dto);
    return { success: true, data: { updated: true } };
  }
}
