import {
  Controller, Get, Post, Put, Delete, Body, Param,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RequirePermission, CurrentUser } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { JobSourcesService } from './job-sources.service';
import { CreateJobSourceDto } from './dto/create-job-source.dto';
import { UpdateJobSourceDto } from './dto/update-job-source.dto';
import { Internal } from '../common/decorators/internal.decorator';

@ApiTags('Job Sources')
@ApiBearerAuth()
@Controller('job-sources')
export class JobSourcesController {
  constructor(private readonly service: JobSourcesService) {}

  @Post()
  @RequirePermission('job_sources', 'create')
  @ApiOperation({
    summary: 'Create a job source',
    description: '**Guard:** `job_sources.create`. Rejected (409) if the name is already taken.',
  })
  async create(@Body() dto: CreateJobSourceDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.create(dto, user);
    return { success: true, data };
  }

  @Get()
  @RequirePermission('job_sources', 'view')
  @ApiOperation({
    summary: 'List all job sources',
    description: '**Guard:** `job_sources.view`. Includes archived types; filter on `active` for pickers.',
  })
  async list() {
    const data = await this.service.list();
    return { success: true, data };
  }

  @Get('internal')
  @Internal()
  @ApiOperation({
    summary: 'Internal: list job sources for the search indexer',
    description: '**Guard:** internal secret (`x-internal-secret`).',
  })
  async listInternal() {
    const jobSources = await this.service.list();
    return {
      success: true,
      data: jobSources.map((t) => ({ id: t.id, name: t.name, active: t.active })),
    };
  }

  @Get(':id')
  @RequirePermission('job_sources', 'view')
  @ApiOperation({
    summary: 'Get a job source by id',
    description: '**Guard:** `job_sources.view`.',
  })
  async findById(@Param('id') id: string) {
    const data = await this.service.findById(id);
    return { success: true, data };
  }

  @Put(':id')
  @RequirePermission('job_sources', 'edit')
  @ApiOperation({
    summary: 'Update a job source',
    description: '**Guard:** `job_sources.edit`. Renaming re-checks name uniqueness (409).',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateJobSourceDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.update(id, dto, user);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('job_sources', 'delete')
  @ApiOperation({
    summary: 'Delete or archive a job source',
    description:
      '**Guard:** `job_sources.delete`. Types still referenced by a deal are archived ' +
      '(`active: false`) instead of deleted, so historical deals keep resolving their name. ' +
      'The response says which happened.',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const { archived } = await this.service.remove(id, user);
    return { success: true, data: { id, archived, deleted: !archived } };
  }
}
