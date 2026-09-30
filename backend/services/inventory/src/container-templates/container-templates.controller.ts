import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { ContainerTemplatesService } from './container-templates.service';
import { CreateContainerTemplateDto } from './dto/create-container-template.dto';
import { UpdateContainerTemplateDto } from './dto/update-container-template.dto';
import { ListContainerTemplatesQueryDto } from './dto/list-container-templates-query.dto';
import { ContainerTemplateDiffQueryDto } from './dto/container-template-diff-query.dto';
import { FillContainerTemplateDto } from './dto/fill-container-template.dto';

/**
 * Container templates ("ideal loadout" of a van). They are container
 * configuration, so they ride on the `containers` permission; the fill moves
 * stock and asks `transfers.create`, as any transfer does.
 */
@ApiTags('Container templates')
@ApiBearerAuth()
@Controller('container-templates')
export class ContainerTemplatesController {
  constructor(private readonly service: ContainerTemplatesService) {}

  @Get()
  @RequirePermission('containers', 'view')
  @ApiOperation({
    summary: 'List container templates',
    description:
      '**Guard:** `containers.view` permission required. Name order; `status` defaults to ' +
      '`active` (`archived` lists the archived ones).',
  })
  async list(@Query() query: ListContainerTemplatesQueryDto) {
    const data = await this.service.list(query.status);
    return { success: true, data };
  }

  @Post()
  @RequirePermission('containers', 'create')
  @ApiOperation({
    summary: 'Create a container template',
    description:
      '**Guard:** `containers.create` permission required. `items` are `{ productId, quantity }` ' +
      '(≥ 1 line, each product once, whole quantities ≥ 1); every product must exist and be ' +
      'stock-managed (400 otherwise) and its name and SKU are taken from the catalog. The name ' +
      'is unique among active templates, case-insensitively (409).',
  })
  async create(@Body() dto: CreateContainerTemplateDto) {
    const data = await this.service.create(dto);
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('containers', 'view')
  @ApiOperation({ summary: 'Get a container template', description: '**Guard:** `containers.view` permission required.' })
  async findById(@Param('id') id: string) {
    const data = await this.service.findById(id);
    return { success: true, data };
  }

  @Put(':id')
  @RequirePermission('containers', 'edit')
  @ApiOperation({
    summary: 'Update a container template',
    description:
      '**Guard:** `containers.edit` permission required. Partial, with the create rules; ' +
      '`items` replaces every line, `description: null` clears it, `status: active` brings an ' +
      'archived template back (its name must be free).',
  })
  async update(@Param('id') id: string, @Body() dto: UpdateContainerTemplateDto) {
    const data = await this.service.update(id, dto);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('containers', 'delete')
  @ApiOperation({
    summary: 'Archive a container template',
    description:
      '**Guard:** `containers.delete` permission required. Archives (never deletes): containers ' +
      'may still name it in `templateId`. Answers the archived template.',
  })
  async archive(@Param('id') id: string) {
    const data = await this.service.archive(id);
    return { success: true, data };
  }

  @Get(':id/diff')
  @RequirePermission('containers', 'view')
  @ApiOperation({
    summary: 'Compare a container with the template',
    description:
      '**Guard:** `containers.view` permission required. `containerId` required (404 when ' +
      'unknown), `warehouseId` optional (404 when unknown). One line per template line, in ' +
      'template order: `target`, `onHand` (the container), `missing` = max(0, target − onHand); ' +
      'with a warehouse also `available` (what it holds) and `willMove` = min(missing, available). ' +
      '`shortLineCount` counts the lines with `missing > 0`, `missingUnits` sums `missing`.',
  })
  async diff(@Param('id') id: string, @Query() query: ContainerTemplateDiffQueryDto) {
    const data = await this.service.diff(id, query.containerId, query.warehouseId);
    return { success: true, data };
  }

  @Post(':id/fill')
  @RequirePermission('transfers', 'create')
  @ApiOperation({
    summary: 'Fill a container from a warehouse up to the template',
    description:
      '**Guard:** `transfers.create` permission required. Moves every line\'s `willMove` in ONE ' +
      'warehouse → container transfer (the `POST /transfers` path: stock, journal, ' +
      '`stock_moved` per item; `notes` default "Template: <name>"). Answers ' +
      '`{ transfer?, moved, short }` — no transfer and `moved: []` when nothing can move (not an ' +
      'error); `short` lists the lines still short. Insufficient stock racing the fill is the ' +
      "transfer's 400; an archived container is a 400.",
  })
  async fill(
    @Param('id') id: string,
    @Body() dto: FillContainerTemplateDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.fill(id, dto, user);
    return { success: true, data };
  }
}
