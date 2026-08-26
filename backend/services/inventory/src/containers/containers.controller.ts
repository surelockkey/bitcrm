import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { ContainersService } from './containers.service';
import { CreateContainerDto } from './dto/create-container.dto';
import { ListContainersQueryDto } from './dto/list-containers-query.dto';
import { UpdateContainerDto } from './dto/update-container.dto';
import { Internal } from '../common/decorators/internal.decorator';
import { coerceInternalLimit } from '../common/utils/internal-pagination';

@ApiTags('Containers')
@ApiBearerAuth()
@Controller('containers')
export class ContainersController {
  constructor(private readonly containersService: ContainersService) {}

  @Post()
  @RequirePermission('containers', 'create')
  @ApiOperation({ summary: 'Create a container', description: '**Guard:** `containers.create` permission required.' })
  async create(@Body() dto: CreateContainerDto) {
    const data = await this.containersService.create(dto);
    return { success: true, data };
  }

  @Get('my')
  @ApiOperation({ summary: "Get the container assigned to the current user", description: '**Guard:** Authenticated (any role). 404 when no container is assigned.' })
  async getMyContainer(@CurrentUser() user: JwtUser) {
    const data = await this.containersService.getMyContainer(user);
    return { success: true, data };
  }

  @Get()
  @RequirePermission('containers', 'view')
  @ApiOperation({ summary: 'List containers (filtered by data scope)', description: '**Guard:** `containers.view` permission required. Results filtered by data scope.' })
  async list(
    @Query() query: ListContainersQueryDto,
    @CurrentUser() user: JwtUser,
    @Req() req: any,
  ) {
    const dataScope = req.resolvedPermissions?.dataScope?.containers;
    const { items, nextCursor } = await this.containersService.list(
      query,
      user,
      dataScope,
    );
    return {
      success: true,
      data: items,
      pagination: { nextCursor, count: items.length },
    };
  }

  @Get(':id')
  @RequirePermission('containers', 'view')
  @ApiOperation({ summary: 'Get container by ID', description: '**Guard:** `containers.view` permission required.' })
  async findById(@Param('id') id: string) {
    const data = await this.containersService.findById(id);
    return { success: true, data };
  }

  @Put(':id')
  @RequirePermission('containers', 'edit')
  @ApiOperation({ summary: 'Update a container', description: '**Guard:** `containers.edit` permission required.' })
  async update(@Param('id') id: string, @Body() dto: UpdateContainerDto) {
    const data = await this.containersService.update(id, dto);
    return { success: true, data };
  }

  @Get(':id/stock')
  @RequirePermission('containers', 'view')
  @ApiOperation({ summary: 'Get stock levels in container', description: '**Guard:** `containers.view` permission required.' })
  async getStock(@Param('id') id: string) {
    const data = await this.containersService.getStock(id);
    return { success: true, data };
  }

  @Get('internal/all')
  @Internal()
  @ApiOperation({ summary: 'Internal: list all containers (for search indexer)', description: '**Guard:** Internal (X-Internal-Secret header required). Service-to-service only.' })
  async listAllInternal(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const data = await this.containersService.findAll(
      coerceInternalLimit(limit),
      cursor,
    );
    return { success: true, data };
  }

  @Get('internal/:id')
  @Internal()
  @ApiOperation({ summary: 'Internal: get container by ID (for search indexer)', description: '**Guard:** Internal (X-Internal-Secret header required). Service-to-service only.' })
  async findByIdInternal(@Param('id') id: string) {
    const data = await this.containersService.findById(id);
    if (!data) {
      throw new NotFoundException(`Container "${id}" not found`);
    }
    return { success: true, data };
  }
}
