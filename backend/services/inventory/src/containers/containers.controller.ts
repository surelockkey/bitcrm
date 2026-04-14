import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { ContainersService } from './containers.service';
import { EnsureContainerDto } from './dto/ensure-container.dto';
import { ListContainersQueryDto } from './dto/list-containers-query.dto';
import { Internal } from '../common/decorators/internal.decorator';

@ApiTags('Containers')
@ApiBearerAuth()
@Controller('containers')
export class ContainersController {
  constructor(private readonly containersService: ContainersService) {}

  @Get('my')
  @ApiOperation({ summary: "Get current technician's container (lazy-created)", description: '**Guard:** Authenticated (any role). Only creates a container for technicians.' })
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

  @Get(':id/stock')
  @RequirePermission('containers', 'view')
  @ApiOperation({ summary: 'Get stock levels in container', description: '**Guard:** `containers.view` permission required.' })
  async getStock(@Param('id') id: string) {
    const data = await this.containersService.getStock(id);
    return { success: true, data };
  }

  @Post('internal/ensure')
  @Internal()
  @ApiOperation({ summary: 'Internal: ensure container exists for technician', description: '**Guard:** Internal (X-Internal-Secret header required). Service-to-service only.' })
  async ensureContainer(@Body() dto: EnsureContainerDto) {
    const data = await this.containersService.ensureContainer(dto);
    return { success: true, data };
  }
}
