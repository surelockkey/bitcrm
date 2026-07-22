import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { SnsPublisherService } from '@bitcrm/shared';
import {
  isAssignable,
  UserEventType,
  type JwtUser,
  type TechnicianJobType,
  type TechnicianServiceArea,
} from '@bitcrm/types';
import {
  TechnicianAssignmentsRepository,
  type AssignmentKind,
  type TechnicianAssignment,
} from './technician-assignments.repository';
import { RolesService } from '../../roles/roles.service';
import { ReviewAssignmentDto } from './dto/assignment.dto';

const TECHNICIAN_ROLE_ID = 'role-technician';
const USER_EVENTS_TOPIC = 'user-events';

/** `changedFields` marker consumed by the deal-service eligibility projection. */
const ASSIGNMENTS_CHANGED = 'assignments';

export interface TechnicianAssignments {
  jobTypes: TechnicianJobType[];
  serviceAreas: TechnicianServiceArea[];
}

@Injectable()
export class TechnicianAssignmentsService {
  private readonly logger = new Logger(TechnicianAssignmentsService.name);

  constructor(
    private readonly repository: TechnicianAssignmentsRepository,
    private readonly rolesService: RolesService,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
  ) {}

  // --- reads ---

  async listAssignments(userId: string, caller: JwtUser): Promise<TechnicianAssignments> {
    await this.assertCanView(caller, userId);
    return this.split(await this.repository.listByUser(userId));
  }

  async listPending(caller: JwtUser) {
    if (!(await this.isPrivileged(caller))) {
      throw new ForbiddenException('Only managers can view pending approvals');
    }
    const [jobTypes, serviceAreas] = await Promise.all([
      this.repository.listPendingAcrossTechs('job_type', 50),
      this.repository.listPendingAcrossTechs('service_area', 50),
    ]);
    return {
      success: true as const,
      data: {
        jobTypes: jobTypes.items.map(toJobType),
        serviceAreas: serviceAreas.items.map(toServiceArea),
      },
      pagination: {
        jobTypesCursor: jobTypes.nextCursor,
        serviceAreasCursor: serviceAreas.nextCursor,
        count: jobTypes.items.length + serviceAreas.items.length,
      },
    };
  }

  // --- writes ---

  /**
   * Technician self-service: ask for catalog entries, pending a manager's review.
   * Entries the technician already holds (unless previously rejected) are skipped,
   * so re-proposing is harmless.
   */
  async propose(
    userId: string,
    kind: AssignmentKind,
    ids: string[],
    caller: JwtUser,
  ): Promise<TechnicianAssignment[]> {
    if (caller.id !== userId) {
      throw new ForbiddenException('You can only propose assignments for yourself');
    }
    return this.createMany(userId, kind, ids, caller, 'pending');
  }

  /**
   * Manager path: grant catalog entries directly, skipping propose→approve.
   * This is how service areas already worked; job types now match.
   */
  async assign(
    userId: string,
    kind: AssignmentKind,
    ids: string[],
    caller: JwtUser,
  ): Promise<TechnicianAssignment[]> {
    await this.assertManager(caller);
    return this.createMany(userId, kind, ids, caller, 'approved');
  }

  private async createMany(
    userId: string,
    kind: AssignmentKind,
    ids: string[],
    caller: JwtUser,
    status: 'pending' | 'approved',
  ): Promise<TechnicianAssignment[]> {
    const before = await this.repository.listByUser(userId);
    const taken = new Set(
      before.filter((a) => a.kind === kind && a.status !== 'rejected').map((a) => a.catalogId),
    );

    const now = new Date().toISOString();
    const created: TechnicianAssignment[] = [];
    for (const raw of ids) {
      const catalogId = raw.trim();
      if (!catalogId || taken.has(catalogId)) continue;
      taken.add(catalogId);

      const assignment: TechnicianAssignment = {
        userId,
        kind,
        catalogId,
        status,
        proposedBy: caller.id,
        proposedAt: now,
        ...(status === 'approved' ? { reviewedBy: caller.id, reviewedAt: now } : {}),
      };
      await this.repository.create(assignment);
      created.push(assignment);
    }

    if (created.length > 0) {
      this.logger.log(
        `${created.length} ${kind} assignment(s) ${status === 'approved' ? 'granted to' : 'proposed by'} ${userId}`,
      );
      if (status === 'approved') await this.publishIfNewlyAssignable(userId, before);
      this.publishUpdated(userId);
    }
    return created;
  }

  async approve(
    userId: string,
    kind: AssignmentKind,
    catalogId: string,
    dto: ReviewAssignmentDto,
    caller: JwtUser,
  ): Promise<TechnicianAssignment> {
    await this.assertManager(caller);
    const before = await this.requireAll(userId, kind, catalogId);

    const updated = await this.repository.updateStatus(userId, kind, catalogId, {
      status: 'approved',
      reviewedBy: caller.id,
      reviewedAt: new Date().toISOString(),
      comments: dto.comments,
    });
    this.logger.log(`${kind} ${catalogId} approved for ${userId} by ${caller.id}`);

    await this.publishIfNewlyAssignable(userId, before);
    this.publishUpdated(userId);
    return updated;
  }

  async reject(
    userId: string,
    kind: AssignmentKind,
    catalogId: string,
    dto: ReviewAssignmentDto,
    caller: JwtUser,
  ): Promise<TechnicianAssignment> {
    await this.assertManager(caller);
    await this.requireAll(userId, kind, catalogId);
    if (!dto.comments) {
      throw new BadRequestException('A comment is required when rejecting an assignment');
    }
    const updated = await this.repository.updateStatus(userId, kind, catalogId, {
      status: 'rejected',
      reviewedBy: caller.id,
      reviewedAt: new Date().toISOString(),
      comments: dto.comments,
    });
    this.logger.log(`${kind} ${catalogId} rejected for ${userId} by ${caller.id}`);
    this.publishUpdated(userId);
    return updated;
  }

  async revoke(
    userId: string,
    kind: AssignmentKind,
    catalogId: string,
    caller: JwtUser,
  ): Promise<void> {
    await this.assertManager(caller);
    await this.requireAll(userId, kind, catalogId);
    await this.repository.delete(userId, kind, catalogId);
    this.logger.log(`${kind} ${catalogId} revoked for ${userId} by ${caller.id}`);
    this.publishUpdated(userId);
  }

  /** Whether the technician meets the onboarding bar (≥1 approved of each kind). */
  async hasApprovedAssignments(userId: string): Promise<boolean> {
    const { jobTypes, serviceAreas } = this.split(await this.repository.listByUser(userId));
    return isAssignable(jobTypes, serviceAreas);
  }

  // --- helpers ---

  private split(all: TechnicianAssignment[]): TechnicianAssignments {
    return {
      jobTypes: all.filter((a) => a.kind === 'job_type').map(toJobType),
      serviceAreas: all.filter((a) => a.kind === 'service_area').map(toServiceArea),
    };
  }

  private async requireAll(
    userId: string,
    kind: AssignmentKind,
    catalogId: string,
  ): Promise<TechnicianAssignment[]> {
    const all = await this.repository.listByUser(userId);
    const found = all.find((a) => a.kind === kind && a.catalogId === catalogId);
    if (!found) throw new NotFoundException('Assignment not found');
    return all;
  }

  /**
   * Publishes tech.approved only on the not-assignable → assignable transition,
   * so downstream consumers see one event per technician rather than one per
   * approval. `before` is the state prior to the write.
   */
  private async publishIfNewlyAssignable(
    userId: string,
    before: TechnicianAssignment[],
  ): Promise<void> {
    const wasAssignable = this.isAssignableSet(before);
    if (wasAssignable) return;

    const after = await this.repository.listByUser(userId);
    if (!this.isAssignableSet(after)) return;

    const eligibility = this.split(after);
    this.publish(UserEventType.TECH_APPROVED, {
      technicianId: userId,
      jobTypeIds: eligibility.jobTypes.filter((j) => j.status === 'approved').map((j) => j.jobTypeId),
      serviceAreaIds: eligibility.serviceAreas
        .filter((a) => a.status === 'approved')
        .map((a) => a.serviceAreaId),
    });
    this.logger.log(`Technician ${userId} is now assignable (tech.approved published)`);
  }

  private isAssignableSet(all: TechnicianAssignment[]): boolean {
    const { jobTypes, serviceAreas } = this.split(all);
    return isAssignable(jobTypes, serviceAreas);
  }

  private publishUpdated(userId: string): void {
    this.publish(UserEventType.TECH_UPDATED, {
      technicianId: userId,
      changedFields: [ASSIGNMENTS_CHANGED],
    });
  }

  private async assertCanView(caller: JwtUser, userId: string): Promise<void> {
    if (caller.id === userId) return;
    if (await this.isPrivileged(caller)) return;
    throw new ForbiddenException('You can only view your own assignments');
  }

  private async assertManager(caller: JwtUser): Promise<void> {
    if (!(await this.isPrivileged(caller))) {
      throw new ForbiddenException('Only managers can review assignments');
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

// --- storage → public entity mappers ---

function toJobType(a: TechnicianAssignment): TechnicianJobType {
  const { kind, catalogId, ...rest } = a;
  return { ...rest, jobTypeId: catalogId };
}

function toServiceArea(a: TechnicianAssignment): TechnicianServiceArea {
  const { kind, catalogId, ...rest } = a;
  return { ...rest, serviceAreaId: catalogId };
}
