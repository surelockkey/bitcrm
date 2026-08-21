import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@bitcrm/shared';
import { ContainerTemplatesService } from './container-templates.service';
import { CreateContainerTemplateDto } from './dto/create-container-template.dto';
import { UpdateContainerTemplateDto } from './dto/update-container-template.dto';

/**
 * Templates are container configuration, so they reuse the `containers`
 * permission rather than introducing a resource of their own.
 */
@ApiTags('Container Templates')
@ApiBearerAuth()
@Controller('container-templates')
export class ContainerTemplatesController {
  constructor(private readonly service: ContainerTemplatesService) {}

  @Get()
  @RequirePermission('containers', 'view')
  @ApiOperation({ summary: 'List container templates', description: '**Guard:** `containers.view` permission required.' })
  async findAll() {
    const data = await this.service.findAll();
    return { success: true, data };
  }

  /** Declared before `:id` so the two-segment route is never shadowed. */
  @Get('diff/:containerId')
  @RequirePermission('containers', 'view')
  @ApiOperation({ summary: "Target-vs-actual stock for a container's assigned template", description: '**Guard:** `containers.view` permission required.' })
  async diffForContainer(@Param('containerId') containerId: string) {
    const data = await this.service.diffForContainer(containerId);
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('containers', 'view')
  @ApiOperation({ summary: 'Get container template by ID', description: '**Guard:** `containers.view` permission required.' })
  async findById(@Param('id') id: string) {
    const data = await this.service.findById(id);
    return { success: true, data };
  }

  @Post()
  @RequirePermission('containers', 'create')
  @ApiOperation({ summary: 'Create container template', description: '**Guard:** `containers.create` permission required.' })
  async create(@Body() dto: CreateContainerTemplateDto) {
    const data = await this.service.create(dto);
    return { success: true, data };
  }

  @Put(':id')
  @RequirePermission('containers', 'edit')
  @ApiOperation({ summary: 'Update container template', description: '**Guard:** `containers.edit` permission required.' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateContainerTemplateDto,
  ) {
    const data = await this.service.update(id, dto);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('containers', 'delete')
  @ApiOperation({ summary: 'Delete container template', description: '**Guard:** `containers.delete` permission required.' })
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
    return { success: true };
  }
}
