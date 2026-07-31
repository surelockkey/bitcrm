import {
  Controller, Get, Post, Put, Delete, Body, Param,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RequirePermission, CurrentUser } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { JobStatusesService } from './job-statuses.service';
import { CreateJobStatusDto } from './dto/create-job-status.dto';
import { UpdateJobStatusDto } from './dto/update-job-status.dto';

@ApiTags('Job Statuses')
@ApiBearerAuth()
@Controller('job-statuses')
export class JobStatusesController {
  constructor(private readonly service: JobStatusesService) {}

  @Post()
  @RequirePermission('job_statuses', 'create')
  @ApiOperation({
    summary: 'Create a job sub-status',
    description: '**Guard:** `job_statuses.create`. Rejected (409) if the name is already taken within the same super-status.',
  })
  async create(@Body() dto: CreateJobStatusDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.create(dto, user);
    return { success: true, data };
  }

  @Get()
  @RequirePermission('job_statuses', 'view')
  @ApiOperation({
    summary: 'List all job sub-statuses',
    description: '**Guard:** `job_statuses.view`. Includes archived statuses; filter on `active` for pickers.',
  })
  async list() {
    const data = await this.service.list();
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('job_statuses', 'view')
  @ApiOperation({
    summary: 'Get a job sub-status by id',
    description: '**Guard:** `job_statuses.view`.',
  })
  async findById(@Param('id') id: string) {
    const data = await this.service.findById(id);
    return { success: true, data };
  }

  @Put(':id')
  @RequirePermission('job_statuses', 'edit')
  @ApiOperation({
    summary: 'Update a job sub-status',
    description: '**Guard:** `job_statuses.edit`. Renaming or re-grouping re-checks name uniqueness within the target super-status (409).',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateJobStatusDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.update(id, dto, user);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('job_statuses', 'delete')
  @ApiOperation({
    summary: 'Delete or archive a job sub-status',
    description:
      '**Guard:** `job_statuses.delete`. Statuses still referenced by a deal are archived ' +
      '(`active: false`) instead of deleted, so historical deals keep resolving their name. ' +
      'The response says which happened.',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const { archived } = await this.service.remove(id, user);
    return { success: true, data: { id, archived, deleted: !archived } };
  }
}
