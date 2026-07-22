import {
  Controller, Get, Post, Put, Delete, Body, Param,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RequirePermission, CurrentUser } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { JobTagsService } from './job-tags.service';
import { CreateJobTagDto } from './dto/create-job-tag.dto';
import { UpdateJobTagDto } from './dto/update-job-tag.dto';
import { Internal } from '../common/decorators/internal.decorator';

@ApiTags('Job Tags')
@ApiBearerAuth()
@Controller('job-tags')
export class JobTagsController {
  constructor(private readonly service: JobTagsService) {}

  @Post()
  @RequirePermission('job_tags', 'create')
  @ApiOperation({
    summary: 'Create a job tag',
    description: '**Guard:** `job_tags.create`. Rejected (409) if the name is already taken.',
  })
  async create(@Body() dto: CreateJobTagDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.create(dto, user);
    return { success: true, data };
  }

  @Get()
  @RequirePermission('job_tags', 'view')
  @ApiOperation({
    summary: 'List all job tags',
    description: '**Guard:** `job_tags.view`. Includes archived types; filter on `active` for pickers.',
  })
  async list() {
    const data = await this.service.list();
    return { success: true, data };
  }

  @Get('internal')
  @Internal()
  @ApiOperation({
    summary: 'Internal: list job tags for the search indexer',
    description: '**Guard:** internal secret (`x-internal-secret`).',
  })
  async listInternal() {
    const jobTags = await this.service.list();
    return {
      success: true,
      data: jobTags.map((t) => ({ id: t.id, name: t.name, active: t.active })),
    };
  }

  @Get(':id')
  @RequirePermission('job_tags', 'view')
  @ApiOperation({
    summary: 'Get a job tag by id',
    description: '**Guard:** `job_tags.view`.',
  })
  async findById(@Param('id') id: string) {
    const data = await this.service.findById(id);
    return { success: true, data };
  }

  @Put(':id')
  @RequirePermission('job_tags', 'edit')
  @ApiOperation({
    summary: 'Update a job tag',
    description: '**Guard:** `job_tags.edit`. Renaming re-checks name uniqueness (409).',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateJobTagDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.update(id, dto, user);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('job_tags', 'delete')
  @ApiOperation({
    summary: 'Delete or archive a job tag',
    description:
      '**Guard:** `job_tags.delete`. Types still referenced by a deal are archived ' +
      '(`active: false`) instead of deleted, so historical deals keep resolving their name. ' +
      'The response says which happened.',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const { archived } = await this.service.remove(id, user);
    return { success: true, data: { id, archived, deleted: !archived } };
  }
}
