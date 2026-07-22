import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { TechnicianAssignmentsService } from './technician-assignments.service';
import { AssignmentIdsDto, ReviewAssignmentDto } from './dto/assignment.dto';

/**
 * What a technician is cleared to do (job types) and where (service areas).
 * Both kinds share one review flow; the routes differ only in the catalog they
 * address, so the handlers delegate with a fixed `kind`.
 */
@ApiTags('Technician Assignments')
@ApiBearerAuth()
@Controller('technicians')
export class TechnicianAssignmentsController {
  constructor(private readonly service: TechnicianAssignmentsService) {}

  // The internal eligibility endpoints live on UsersController instead — they
  // must join identity and home coordinates, which only UsersService has.

  // --- review queue ---

  @Get('assignments/pending')
  @RequirePermission('job_types', 'approve')
  @ApiOperation({
    summary: 'List pending proposals across all technicians',
    description: '**Guard:** `job_types.approve`. Manager+ only. Backs the approval dashboard / 24h SLA.',
  })
  async listPending(@CurrentUser() user: JwtUser) {
    return this.service.listPending(user);
  }

  @Get(':id/assignments')
  @RequirePermission('job_types', 'view')
  @ApiOperation({
    summary: 'List a technician’s job types and service areas with statuses',
    description: '**Guard:** `job_types.view`. Manager+ or self.',
  })
  async list(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const data = await this.service.listAssignments(id, user);
    return { success: true, data };
  }

  // --- job types ---

  @Post(':id/job-types/propose')
  @RequirePermission('job_types', 'propose')
  @ApiOperation({
    summary: 'Propose job types for approval',
    description:
      '**Guard:** `job_types.propose`. Technician self only. Creates pending rows; ' +
      'ids the technician already holds (unless rejected) are skipped.',
  })
  async proposeJobTypes(
    @Param('id') id: string,
    @Body() dto: AssignmentIdsDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.propose(id, 'job_type', dto.ids, user);
    return { success: true, data };
  }

  @Post(':id/job-types')
  @RequirePermission('job_types', 'approve')
  @ApiOperation({
    summary: 'Assign job types to a technician directly (manager)',
    description:
      '**Guard:** `job_types.approve`. Manager+. Creates already-approved rows, skipping ' +
      'propose→approve. Publishes `tech.approved` on the assignable transition.',
  })
  async assignJobTypes(
    @Param('id') id: string,
    @Body() dto: AssignmentIdsDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.assign(id, 'job_type', dto.ids, user);
    return { success: true, data };
  }

  @Post(':id/job-types/:jobTypeId/approve')
  @RequirePermission('job_types', 'approve')
  @ApiOperation({
    summary: 'Approve a proposed job type',
    description: '**Guard:** `job_types.approve`. Publishes `tech.approved` on the assignable transition.',
  })
  async approveJobType(
    @Param('id') id: string,
    @Param('jobTypeId') jobTypeId: string,
    @Body() dto: ReviewAssignmentDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.approve(id, 'job_type', jobTypeId, dto, user);
    return { success: true, data };
  }

  @Post(':id/job-types/:jobTypeId/reject')
  @RequirePermission('job_types', 'approve')
  @ApiOperation({
    summary: 'Reject a proposed job type',
    description: '**Guard:** `job_types.approve`. A comment is required.',
  })
  async rejectJobType(
    @Param('id') id: string,
    @Param('jobTypeId') jobTypeId: string,
    @Body() dto: ReviewAssignmentDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.reject(id, 'job_type', jobTypeId, dto, user);
    return { success: true, data };
  }

  @Delete(':id/job-types/:jobTypeId')
  @RequirePermission('job_types', 'revoke')
  @ApiOperation({
    summary: 'Revoke a technician’s job type',
    description: '**Guard:** `job_types.revoke`. Manager+.',
  })
  async revokeJobType(
    @Param('id') id: string,
    @Param('jobTypeId') jobTypeId: string,
    @CurrentUser() user: JwtUser,
  ) {
    await this.service.revoke(id, 'job_type', jobTypeId, user);
    return { success: true, data: { jobTypeId, revoked: true } };
  }

  // --- service areas ---

  @Post(':id/service-areas/propose')
  @RequirePermission('service_areas', 'propose')
  @ApiOperation({
    summary: 'Propose service areas for approval',
    description: '**Guard:** `service_areas.propose`. Technician self only.',
  })
  async proposeServiceAreas(
    @Param('id') id: string,
    @Body() dto: AssignmentIdsDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.propose(id, 'service_area', dto.ids, user);
    return { success: true, data };
  }

  @Post(':id/service-areas')
  @RequirePermission('service_areas', 'approve')
  @ApiOperation({
    summary: 'Assign service areas to a technician directly (manager)',
    description:
      '**Guard:** `service_areas.approve`. Manager+. Creates already-approved rows from the catalog.',
  })
  async assignServiceAreas(
    @Param('id') id: string,
    @Body() dto: AssignmentIdsDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.assign(id, 'service_area', dto.ids, user);
    return { success: true, data };
  }

  @Post(':id/service-areas/:serviceAreaId/approve')
  @RequirePermission('service_areas', 'approve')
  @ApiOperation({
    summary: 'Approve a proposed service area',
    description: '**Guard:** `service_areas.approve`.',
  })
  async approveServiceArea(
    @Param('id') id: string,
    @Param('serviceAreaId') serviceAreaId: string,
    @Body() dto: ReviewAssignmentDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.approve(id, 'service_area', serviceAreaId, dto, user);
    return { success: true, data };
  }

  @Post(':id/service-areas/:serviceAreaId/reject')
  @RequirePermission('service_areas', 'approve')
  @ApiOperation({
    summary: 'Reject a proposed service area',
    description: '**Guard:** `service_areas.approve`. A comment is required.',
  })
  async rejectServiceArea(
    @Param('id') id: string,
    @Param('serviceAreaId') serviceAreaId: string,
    @Body() dto: ReviewAssignmentDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.reject(id, 'service_area', serviceAreaId, dto, user);
    return { success: true, data };
  }

  @Delete(':id/service-areas/:serviceAreaId')
  @RequirePermission('service_areas', 'revoke')
  @ApiOperation({
    summary: 'Revoke a technician’s service area',
    description: '**Guard:** `service_areas.revoke`. Manager+.',
  })
  async revokeServiceArea(
    @Param('id') id: string,
    @Param('serviceAreaId') serviceAreaId: string,
    @CurrentUser() user: JwtUser,
  ) {
    await this.service.revoke(id, 'service_area', serviceAreaId, user);
    return { success: true, data: { serviceAreaId, revoked: true } };
  }
}
