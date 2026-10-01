import {
  Controller, Get, Post, Put, Delete, Body, Param,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RequirePermission, CurrentUser } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { ClientTagsService } from './client-tags.service';
import { CreateClientTagDto } from './dto/create-client-tag.dto';
import { UpdateClientTagDto } from './dto/update-client-tag.dto';
import { Internal } from '../common/decorators/internal.decorator';

@ApiTags('Client Tags')
@ApiBearerAuth()
@Controller('client-tags')
export class ClientTagsController {
  constructor(private readonly service: ClientTagsService) {}

  @Post()
  @RequirePermission('client_tags', 'create')
  @ApiOperation({
    summary: 'Create a client tag',
    description: '**Guard:** `client_tags.create`. Rejected (409) if the name is already taken.',
  })
  async create(@Body() dto: CreateClientTagDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.create(dto, user);
    return { success: true, data };
  }

  @Get()
  @RequirePermission('client_tags', 'view')
  @ApiOperation({
    summary: 'List all client tags',
    description: '**Guard:** `client_tags.view`. Includes archived types; filter on `active` for pickers.',
  })
  async list() {
    const data = await this.service.list();
    return { success: true, data };
  }

  @Get('internal')
  @Internal()
  @ApiOperation({
    summary: 'Internal: list client tags for the search indexer',
    description: '**Guard:** internal secret (`x-internal-secret`).',
  })
  async listInternal() {
    const clientTags = await this.service.list();
    return {
      success: true,
      data: clientTags.map((t) => ({ id: t.id, name: t.name, active: t.active })),
    };
  }

  @Get(':id')
  @RequirePermission('client_tags', 'view')
  @ApiOperation({
    summary: 'Get a client tag by id',
    description: '**Guard:** `client_tags.view`.',
  })
  async findById(@Param('id') id: string) {
    const data = await this.service.findById(id);
    return { success: true, data };
  }

  @Put(':id')
  @RequirePermission('client_tags', 'edit')
  @ApiOperation({
    summary: 'Update a client tag',
    description: '**Guard:** `client_tags.edit`. Renaming re-checks name uniqueness (409).',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateClientTagDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.update(id, dto, user);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('client_tags', 'delete')
  @ApiOperation({
    summary: 'Archive a client tag',
    description:
      '**Guard:** `client_tags.delete`. The tag is archived (`active: false`), never destroyed: ' +
      'it leaves the pickers and keeps resolving on the clients that carry it.',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const { archived } = await this.service.remove(id, user);
    return { success: true, data: { id, archived, deleted: !archived } };
  }
}
