import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { TechnicianSkillsService } from './technician-skills.service';
import { Internal } from '../../common/decorators/internal.decorator';
import { ProposeSkillsDto } from './dto/propose-skills.dto';
import { ReviewSkillDto } from './dto/review-skill.dto';

@ApiTags('Technician Skills')
@ApiBearerAuth()
@Controller('technicians')
export class TechnicianSkillsController {
  constructor(private readonly skillsService: TechnicianSkillsService) {}

  @Get('internal/assignable')
  @Internal()
  @ApiOperation({
    summary: 'Internal: list assignable technicians (deal-service backfill)',
    description:
      '**Guard:** Internal only (`x-internal-secret` required). Returns every technician with an ' +
      'approved job type AND service area, with their approved skills/areas.',
  })
  async listAssignable() {
    const data = await this.skillsService.listAssignableTechnicians();
    return { success: true, data };
  }

  @Get('internal/:id/eligibility')
  @Internal()
  @ApiOperation({
    summary: 'Internal: a technician’s assignment eligibility',
    description: '**Guard:** Internal only (`x-internal-secret` required). Used by deal-service on tech.updated.',
  })
  async eligibility(@Param('id') id: string) {
    const data = await this.skillsService.getEligibility(id);
    return { success: true, data };
  }

  @Get('skills/pending')
  @RequirePermission('skills', 'approve')
  @ApiOperation({
    summary: 'List pending skill proposals across all technicians',
    description:
      '**Guard:** `skills.approve` permission required. Manager+ only. ' +
      'Backs the manager approval dashboard / 24h SLA.',
  })
  async listPending(@CurrentUser() user: JwtUser) {
    return this.skillsService.listPending(user);
  }

  @Post(':id/skills/propose')
  @RequirePermission('skills', 'propose')
  @ApiOperation({
    summary: 'Propose job types & service areas for approval',
    description:
      '**Guard:** `skills.propose` permission required. Technician self only. ' +
      'Creates pending skills; duplicates of existing non-rejected skills are skipped.',
  })
  async propose(
    @Param('id') id: string,
    @Body() dto: ProposeSkillsDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.skillsService.propose(id, dto, user);
    return { success: true, data };
  }

  @Get(':id/skills')
  @RequirePermission('skills', 'view')
  @ApiOperation({
    summary: 'List a technician’s skills with statuses',
    description: '**Guard:** `skills.view` permission required. Manager+ or self.',
  })
  async list(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const data = await this.skillsService.listSkills(id, user);
    return { success: true, data };
  }

  @Post(':id/skills/:skillId/approve')
  @RequirePermission('skills', 'approve')
  @ApiOperation({
    summary: 'Approve a proposed skill',
    description:
      '**Guard:** `skills.approve` permission required. Manager+. ' +
      'Publishes `tech.approved` when the technician first becomes assignable.',
  })
  async approve(
    @Param('id') id: string,
    @Param('skillId') skillId: string,
    @Body() dto: ReviewSkillDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.skillsService.approve(id, skillId, dto, user);
    return { success: true, data };
  }

  @Post(':id/skills/:skillId/reject')
  @RequirePermission('skills', 'approve')
  @ApiOperation({
    summary: 'Reject a proposed skill',
    description:
      '**Guard:** `skills.approve` permission required. Manager+. A comment is required.',
  })
  async reject(
    @Param('id') id: string,
    @Param('skillId') skillId: string,
    @Body() dto: ReviewSkillDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.skillsService.reject(id, skillId, dto, user);
    return { success: true, data };
  }

  @Delete(':id/skills/:skillId')
  @RequirePermission('skills', 'revoke')
  @ApiOperation({
    summary: 'Revoke an approved skill',
    description: '**Guard:** `skills.revoke` permission required. Manager+.',
  })
  async revoke(
    @Param('id') id: string,
    @Param('skillId') skillId: string,
    @CurrentUser() user: JwtUser,
  ) {
    await this.skillsService.revoke(id, skillId, user);
    return { success: true, data: null };
  }
}
