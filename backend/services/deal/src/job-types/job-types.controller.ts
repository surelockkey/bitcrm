import {
  Controller, Get, Post, Put, Delete, Body, Param,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RequirePermission, CurrentUser } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { JobTypesService } from './job-types.service';
import { CreateJobTypeDto } from './dto/create-job-type.dto';
import { UpdateJobTypeDto } from './dto/update-job-type.dto';
import { Internal } from '../common/decorators/internal.decorator';

@ApiTags('Job Types')
@ApiBearerAuth()
@Controller('job-types')
export class JobTypesController {
  constructor(private readonly service: JobTypesService) {}

  @Post()
  @RequirePermission('job_types', 'create')
  @ApiOperation({
    summary: 'Create a job type',
    description: '**Guard:** `job_types.create`. Rejected (409) if the name is already taken.',
  })
  async create(@Body() dto: CreateJobTypeDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.create(dto, user);
    return { success: true, data };
  }

  @Get()
  @RequirePermission('job_types', 'view')
  @ApiOperation({
    summary: 'List all job types',
    description: '**Guard:** `job_types.view`. Includes archived types; filter on `active` for pickers.',
  })
  async list() {
    const data = await this.service.list();
    return { success: true, data };
  }

  @Get('internal')
  @Internal()
  @ApiOperation({
    summary: 'Internal: list job types for the search indexer',
    description: '**Guard:** internal secret (`x-internal-secret`).',
  })
  async listInternal() {
    const jobTypes = await this.service.list();
    return {
      success: true,
      data: jobTypes.map((t) => ({ id: t.id, name: t.name, active: t.active })),
    };
  }

  @Get(':id')
  @RequirePermission('job_types', 'view')
  @ApiOperation({
    summary: 'Get a job type by id',
    description: '**Guard:** `job_types.view`.',
  })
  async findById(@Param('id') id: string) {
    const data = await this.service.findById(id);
    return { success: true, data };
  }

  @Put(':id')
  @RequirePermission('job_types', 'edit')
  @ApiOperation({
    summary: 'Update a job type',
    description: '**Guard:** `job_types.edit`. Renaming re-checks name uniqueness (409).',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateJobTypeDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.update(id, dto, user);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('job_types', 'delete')
  @ApiOperation({
    summary: 'Delete or archive a job type',
    description:
      '**Guard:** `job_types.delete`. Types still referenced by a deal are archived ' +
      '(`active: false`) instead of deleted, so historical deals keep resolving their name. ' +
      'The response says which happened.',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const { archived } = await this.service.remove(id, user);
    return { success: true, data: { id, archived, deleted: !archived } };
  }
}
