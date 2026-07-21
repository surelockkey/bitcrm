import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { SnsPublisherService } from '@bitcrm/shared';
import { type JwtUser, type TechnicianSkill, UserEventType } from '@bitcrm/types';
import { TechnicianSkillsRepository } from './technician-skills.repository';
import { RolesService } from '../../roles/roles.service';
import { ProposeSkillsDto } from './dto/propose-skills.dto';
import { ReviewSkillDto } from './dto/review-skill.dto';

const TECHNICIAN_ROLE_ID = 'role-technician';
const USER_EVENTS_TOPIC = 'user-events';

@Injectable()
export class TechnicianSkillsService {
  private readonly logger = new Logger(TechnicianSkillsService.name);

  constructor(
    private readonly repository: TechnicianSkillsRepository,
    private readonly rolesService: RolesService,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
  ) {}

  async propose(
    userId: string,
    dto: ProposeSkillsDto,
    caller: JwtUser,
  ): Promise<TechnicianSkill[]> {
    if (caller.id !== userId) {
      throw new ForbiddenException('You can only propose skills for yourself');
    }

    const existing = await this.repository.listByUser(userId);
    const taken = new Set(
      existing
        .filter((s) => s.status !== 'rejected')
        .map((s) => `${s.type}:${s.value}`),
    );

    const requested: Array<{ type: TechnicianSkill['type']; value: string }> = [
      ...(dto.jobTypes ?? []).map((value) => ({ type: 'job_type' as const, value })),
      ...(dto.serviceAreas ?? []).map((value) => ({ type: 'service_area' as const, value })),
    ];

    const now = new Date().toISOString();
    const created: TechnicianSkill[] = [];
    for (const r of requested) {
      if (taken.has(`${r.type}:${r.value}`)) continue;
      const skill: TechnicianSkill = {
        skillId: randomUUID(),
        userId,
        type: r.type,
        value: r.value,
        status: 'pending',
        proposedBy: caller.id,
        proposedAt: now,
      };
      await this.repository.create(skill);
      created.push(skill);
    }

    if (created.length > 0) {
      this.logger.log(`Technician ${userId} proposed ${created.length} skill(s)`);
      this.publish(UserEventType.SKILL_PROPOSED, {
        technicianId: userId,
        skills: created.map((s) => ({ type: s.type, value: s.value })),
      });
    }
    return created;
  }

  /**
   * Manager path: assign catalog service areas to a technician directly, skipping
   * the propose→approve round-trip. Areas are created already-approved (reviewed
   * by the caller). Duplicates of existing non-rejected areas are skipped.
   */
  async assignServiceAreas(
    userId: string,
    values: string[],
    caller: JwtUser,
  ): Promise<TechnicianSkill[]> {
    await this.assertManager(caller);

    const existing = await this.repository.listByUser(userId);
    const taken = new Set(
      existing
        .filter((s) => s.status !== 'rejected' && s.type === 'service_area')
        .map((s) => s.value),
    );

    const now = new Date().toISOString();
    const created: TechnicianSkill[] = [];
    for (const value of values) {
      const trimmed = value.trim();
      if (!trimmed || taken.has(trimmed)) continue;
      taken.add(trimmed);
      const skill: TechnicianSkill = {
        skillId: randomUUID(),
        userId,
        type: 'service_area',
        value: trimmed,
        status: 'approved',
        proposedBy: caller.id,
        proposedAt: now,
        reviewedBy: caller.id,
        reviewedAt: now,
      };
      await this.repository.create(skill);
      created.push(skill);
    }

    if (created.length > 0) {
      this.logger.log(
        `Manager ${caller.id} assigned ${created.length} service area(s) to ${userId}`,
      );
      await this.publishIfNewlyAssignable(userId, new Set(created.map((s) => s.skillId)));
      this.publish(UserEventType.TECH_UPDATED, {
        technicianId: userId,
        changedFields: ['skills'],
      });
    }
    return created;
  }

  /**
   * Internal: every assignable technician (≥1 approved job type AND service
   * area) with their approved skills. Powers the deal-service eligibility
   * backfill. Matches the TechApprovedEvent payload shape.
   */
  async listAssignableTechnicians(): Promise<
    Array<{ technicianId: string; approvedSkills: string[]; serviceAreas: string[] }>
  > {
    const approved = await this.repository.listAllApproved();
    const byTech = new Map<string, { jobTypes: string[]; areas: string[] }>();
    for (const s of approved) {
      const entry = byTech.get(s.userId) ?? { jobTypes: [], areas: [] };
      if (s.type === 'job_type') entry.jobTypes.push(s.value);
      else entry.areas.push(s.value);
      byTech.set(s.userId, entry);
    }
    return [...byTech.entries()]
      .filter(([, v]) => v.jobTypes.length > 0 && v.areas.length > 0)
      .map(([technicianId, v]) => ({
        technicianId,
        approvedSkills: v.jobTypes,
        serviceAreas: v.areas,
      }));
  }

  /** Internal: a single technician's current assignment eligibility. */
  async getEligibility(userId: string): Promise<{
    technicianId: string;
    assignable: boolean;
    approvedSkills: string[];
    serviceAreas: string[];
  }> {
    const skills = await this.repository.listByUser(userId);
    const approvedSkills = skills
      .filter((s) => s.status === 'approved' && s.type === 'job_type')
      .map((s) => s.value);
    const serviceAreas = skills
      .filter((s) => s.status === 'approved' && s.type === 'service_area')
      .map((s) => s.value);
    return {
      technicianId: userId,
      assignable: approvedSkills.length > 0 && serviceAreas.length > 0,
      approvedSkills,
      serviceAreas,
    };
  }

  async listSkills(userId: string, caller: JwtUser): Promise<TechnicianSkill[]> {
    await this.assertCanView(caller, userId);
    return this.repository.listByUser(userId);
  }

  async listPending(caller: JwtUser) {
    if (!(await this.isPrivileged(caller))) {
      throw new ForbiddenException('Only managers can view pending skill approvals');
    }
    const result = await this.repository.listPendingAcrossTechs(50);
    return {
      success: true as const,
      data: result.items,
      pagination: { nextCursor: result.nextCursor, count: result.items.length },
    };
  }

  async approve(
    userId: string,
    skillId: string,
    dto: ReviewSkillDto,
    caller: JwtUser,
  ): Promise<TechnicianSkill> {
    await this.assertManager(caller);
    const skill = await this.requireSkill(userId, skillId);

    const updated = await this.repository.updateStatus(userId, skillId, {
      status: 'approved',
      reviewedBy: caller.id,
      reviewedAt: new Date().toISOString(),
      comments: dto.comments,
    });
    this.logger.log(`Skill ${skillId} approved for ${userId} by ${caller.id}`);

    await this.maybePublishAssignable(userId, skillId, skill.status);
    this.publish(UserEventType.TECH_UPDATED, { technicianId: userId, changedFields: ['skills'] });
    return updated;
  }

  async reject(
    userId: string,
    skillId: string,
    dto: ReviewSkillDto,
    caller: JwtUser,
  ): Promise<TechnicianSkill> {
    await this.assertManager(caller);
    await this.requireSkill(userId, skillId);
    if (!dto.comments) {
      throw new BadRequestException('A comment is required when rejecting a skill');
    }
    const updated = await this.repository.updateStatus(userId, skillId, {
      status: 'rejected',
      reviewedBy: caller.id,
      reviewedAt: new Date().toISOString(),
      comments: dto.comments,
    });
    this.logger.log(`Skill ${skillId} rejected for ${userId} by ${caller.id}`);
    this.publish(UserEventType.TECH_UPDATED, { technicianId: userId, changedFields: ['skills'] });
    return updated;
  }

  async revoke(userId: string, skillId: string, caller: JwtUser): Promise<void> {
    await this.assertManager(caller);
    await this.requireSkill(userId, skillId);
    await this.repository.delete(userId, skillId);
    this.logger.log(`Skill ${skillId} revoked for ${userId} by ${caller.id}`);
    this.publish(UserEventType.TECH_UPDATED, { technicianId: userId, changedFields: ['skills'] });
  }

  // --- helpers ---

  private async requireSkill(userId: string, skillId: string): Promise<TechnicianSkill> {
    const skill = await this.repository.getById(userId, skillId);
    if (!skill) throw new NotFoundException('Skill not found');
    return skill;
  }

  /** Publishes tech.approved only on the transition to "assignable". */
  private async maybePublishAssignable(
    userId: string,
    approvedSkillId: string,
    priorStatus: TechnicianSkill['status'],
  ): Promise<void> {
    const after = await this.repository.listByUser(userId);
    const before = after.map((s) =>
      s.skillId === approvedSkillId ? { ...s, status: priorStatus } : s,
    );
    if (this.isAssignable(before) || !this.isAssignable(after)) return;

    this.publish(UserEventType.TECH_APPROVED, {
      technicianId: userId,
      approvedSkills: this.approvedValues(after, 'job_type'),
      serviceAreas: this.approvedValues(after, 'service_area'),
    });
    this.logger.log(`Technician ${userId} is now assignable (tech.approved published)`);
  }

  /** Publishes tech.approved when a batch of new skills tips the tech into assignable. */
  private async publishIfNewlyAssignable(
    userId: string,
    newSkillIds: Set<string>,
  ): Promise<void> {
    const after = await this.repository.listByUser(userId);
    const before = after.filter((s) => !newSkillIds.has(s.skillId));
    if (this.isAssignable(before) || !this.isAssignable(after)) return;

    this.publish(UserEventType.TECH_APPROVED, {
      technicianId: userId,
      approvedSkills: this.approvedValues(after, 'job_type'),
      serviceAreas: this.approvedValues(after, 'service_area'),
    });
    this.logger.log(`Technician ${userId} is now assignable (tech.approved published)`);
  }

  private isAssignable(skills: TechnicianSkill[]): boolean {
    const hasJob = skills.some((s) => s.status === 'approved' && s.type === 'job_type');
    const hasArea = skills.some((s) => s.status === 'approved' && s.type === 'service_area');
    return hasJob && hasArea;
  }

  private approvedValues(skills: TechnicianSkill[], type: TechnicianSkill['type']): string[] {
    return skills.filter((s) => s.status === 'approved' && s.type === type).map((s) => s.value);
  }

  private async assertCanView(caller: JwtUser, userId: string): Promise<void> {
    if (caller.id === userId) return;
    if (await this.isPrivileged(caller)) return;
    throw new ForbiddenException('You can only view your own skills');
  }

  private async assertManager(caller: JwtUser): Promise<void> {
    if (!(await this.isPrivileged(caller))) {
      throw new ForbiddenException('Only managers can review skills');
    }
  }

  private async isPrivileged(caller: JwtUser): Promise<boolean> {
    if (!caller.roleId) throw new ForbiddenException('User has no roleId assigned');
    const callerRole = await this.rolesService.findById(caller.roleId);
    if (callerRole.isSystem && callerRole.name === 'Super Admin') return true;
    const techRole = await this.rolesService.findById(TECHNICIAN_ROLE_ID);
    return callerRole.priority > techRole.priority;
  }

  private publish(eventType: string, payload: Record<string, unknown>): void {
    if (!this.snsPublisher) return;
    this.snsPublisher
      .publish(USER_EVENTS_TOPIC, eventType, payload)
      .catch((err) => this.logger.warn(`Failed to publish ${eventType}: ${err.message}`));
  }
}
