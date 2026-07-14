import { randomUUID } from 'crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { CognitoAdminService, PermissionCacheReader, SnsPublisherService, BusinessMetricsService } from '@bitcrm/shared';
import {
  type User,
  type JwtUser,
  type UserPermissionOverrides,
  type ResolvedPermissions,
  UserStatus,
} from '@bitcrm/types';
import { UsersRepository } from './users.repository';
import { UsersCacheService } from './users-cache.service';
import { TechniciansRepository } from '../technicians/technicians.repository';
import { TechnicianSkillsRepository } from '../technicians/skills/technician-skills.repository';
import { CommissionRepository } from '../technicians/commission/commission.repository';
import { buildDefaultCommission } from '../technicians/commission/commission.defaults';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { RolesService } from '../roles/roles.service';
import { RolesCacheService } from '../roles/roles-cache.service';
import { PermissionResolverService } from '../roles/permission-resolver.service';

/**
 * The technician shape deal-service consumes for assignment ranking. Mirrors
 * `TechnicianInfo` in deal-service's `internal-http.service.ts` — the contract
 * that service has been coding against all along.
 */
export interface TechnicianDispatchInfo {
  id: string;
  firstName: string;
  lastName: string;
  department: string;
  skills: string[];
  serviceAreas: string[];
  homeAddress?: { lat: number; lng: number };
}

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly repository: UsersRepository,
    private readonly cache: UsersCacheService,
    private readonly cognitoAdmin: CognitoAdminService,
    private readonly permissionCacheReader: PermissionCacheReader,
    private readonly rolesService: RolesService,
    private readonly rolesCache: RolesCacheService,
    private readonly permissionResolver: PermissionResolverService,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
    @Optional() private readonly techniciansRepository?: TechniciansRepository,
    @Optional() private readonly commissionRepository?: CommissionRepository,
    @Optional()
    private readonly technicianSkillsRepository?: TechnicianSkillsRepository,
  ) {}

  private static readonly TECHNICIAN_ROLE_ID = 'role-technician';

  /**
   * Technicians as deal-service needs them for dispatch: identity, approved
   * skills and service areas, and home coordinates for distance ranking.
   *
   * deal-service has always called this endpoint (`internal-http.service.ts`),
   * but it was never implemented — the 404 was swallowed into an empty array,
   * which is why the "qualified technicians" list is blank in the UI.
   *
   * A technician needs at least one approved job type AND one approved service
   * area to be assignable, so anyone without approved skills is left out.
   */
  async listTechniciansForDispatch(filters: {
    serviceArea?: string;
    skill?: string;
  }): Promise<TechnicianDispatchInfo[]> {
    if (!this.techniciansRepository || !this.technicianSkillsRepository) {
      // Returning [] quietly is how this endpoint's absence went unnoticed for so
      // long — deal-service swallowed the 404 and dispatch just looked empty. Say so.
      this.logger.error(
        'Technician repositories are not wired — dispatch will see no candidates',
      );
      return [];
    }

    const [users, approved, profiles] = await Promise.all([
      this.repository.findByRoleId(UsersService.TECHNICIAN_ROLE_ID),
      this.technicianSkillsRepository.listAllApproved(),
      this.listAllTechnicianProfiles(),
    ]);

    const skillsByTech = new Map<string, { skills: string[]; areas: string[] }>();
    for (const skill of approved) {
      const entry = skillsByTech.get(skill.userId) ?? { skills: [], areas: [] };
      if (skill.type === 'job_type') entry.skills.push(skill.value);
      else entry.areas.push(skill.value);
      skillsByTech.set(skill.userId, entry);
    }

    const homeByTech = new Map(profiles.map((p) => [p.userId, p.homeAddress]));

    const technicians: TechnicianDispatchInfo[] = [];

    for (const user of users) {
      const entry = skillsByTech.get(user.id);
      if (!entry) continue;
      if (filters.serviceArea && !entry.areas.includes(filters.serviceArea)) continue;
      if (filters.skill && !entry.skills.includes(filters.skill)) continue;

      const home = homeByTech.get(user.id);
      const mappable = home?.lat !== undefined && home?.lng !== undefined;

      technicians.push({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        department: user.department,
        skills: entry.skills,
        serviceAreas: entry.areas,
        homeAddress: mappable
          ? { lat: home.lat as number, lng: home.lng as number }
          : undefined,
      });
    }

    return technicians;
  }

  /**
   * Profiles are cursor-paginated; dispatch needs all of them at once. Bounded so
   * a repeating cursor can't spin forever — the field team will never approach it.
   */
  private async listAllTechnicianProfiles() {
    const all: Array<{
      userId: string;
      homeAddress?: { lat?: number; lng?: number };
    }> = [];
    let cursor: string | undefined;

    do {
      const page = await this.techniciansRepository!.listAll(100, cursor);
      all.push(...(page.items as typeof all));
      cursor = page.nextCursor;
    } while (cursor && all.length < 5000);

    return all;
  }

  /**
   * Self-heal on boot: ensure every existing technician user has a (pending)
   * technician profile, so legacy technicians created before profiles existed
   * still appear in technician listings / onboarding tracking — no manual
   * migration required. Best-effort and idempotent.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.backfillTechnicianProfiles();
    } catch (err) {
      this.logger.warn(
        `Technician profile backfill on boot failed: ${(err as Error).message}`,
      );
    }
  }

  private async backfillTechnicianProfiles(): Promise<void> {
    if (!this.techniciansRepository) return;
    let cursor: string | undefined;
    let created = 0;
    do {
      const { items, nextCursor } = await this.repository.findByRole(
        UsersService.TECHNICIAN_ROLE_ID,
        200,
        cursor,
      );
      for (const user of items) {
        const existing = await this.techniciansRepository.getProfile(user.id);
        if (!existing) {
          await this.ensureTechnicianProfile(user.id, user.roleId);
          created++;
        }
        await this.ensureTechnicianCommission(user.id);
      }
      cursor = nextCursor;
    } while (cursor);
    if (created > 0) {
      this.logger.log(`Backfilled ${created} technician profile(s) on boot`);
    }
  }

  /**
   * Ensure a technician has a commission config; create the EPIC-6 default if
   * not. "No commission yet" is a valid onboarding state for a brand-new
   * technician, so this only fills the gap — managers override by POSTing a new
   * version. Best-effort.
   */
  private async ensureTechnicianCommission(userId: string): Promise<void> {
    if (!this.commissionRepository) return;
    try {
      const existing = await this.commissionRepository.getLatest(userId);
      if (existing) return;
      const now = new Date().toISOString();
      await this.commissionRepository.create(
        buildDefaultCommission(userId, 'system-backfill', now),
      );
      this.logger.log(`Provisioned default commission for ${userId}`);
    } catch (err) {
      this.logger.warn(
        `Failed to provision commission for ${userId}: ${(err as Error).message}`,
      );
    }
  }

  async create(dto: CreateUserDto, caller: JwtUser): Promise<User> {
    // Validate the role exists
    const newRole = await this.rolesService.findById(dto.roleId);

    // Check caller can assign this role (must have higher priority)
    const callerRoleId = await this.resolveCallerRoleId(caller);
    const callerRole = await this.rolesService.findById(callerRoleId);
    const isSuperAdmin = callerRole.isSystem && callerRole.name === 'Super Admin';
    if (!isSuperAdmin && callerRole.priority <= newRole.priority) {
      throw new ForbiddenException(
        'You cannot create a user with a role equal to or above your own',
      );
    }

    const id = randomUUID();

    let cognitoSub: string;
    try {
      const cognitoResult = await this.cognitoAdmin.createUser(dto.email, {
        'custom:role_id': dto.roleId,
        'custom:department': dto.department,
        'custom:user_id': id,
      });
      cognitoSub = cognitoResult.User?.Attributes?.find(
        (a) => a.Name === 'sub',
      )?.Value as string;
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.name === 'UsernameExistsException'
      ) {
        throw new ConflictException('A user with this email already exists');
      }
      throw error;
    }

    const now = new Date().toISOString();
    const user: User = {
      id,
      cognitoSub,
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      roleId: dto.roleId,
      department: dto.department,
      status: UserStatus.ACTIVE,
      permissionOverrides: undefined,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await this.repository.create(user);
    } catch (error) {
      // Rollback Cognito user if DynamoDB write fails
      await this.cognitoAdmin.deleteUser(dto.email).catch((rollbackErr) => {
        this.logger.error(`Failed to rollback Cognito user ${dto.email}: ${rollbackErr.message}`);
      });
      throw error;
    }

    await this.cache.setUser(user);
    this.businessMetrics?.entityCreated.inc({ entity_type: 'user' });
    this.publishUserEvent('user.activated', user);
    await this.ensureTechnicianProfile(user.id, user.roleId);
    return user;
  }

  async findById(id: string): Promise<User> {
    const cached = await this.cache.getUser(id);
    if (cached) {
      this.businessMetrics?.cacheHits.inc({ entity_type: 'user' });
      return cached;
    }

    this.businessMetrics?.cacheMisses.inc({ entity_type: 'user' });
    const user = await this.repository.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.cache.setUser(user);
    return user;
  }

  async findCurrentUser(caller: JwtUser): Promise<User> {
    return this.findById(caller.id);
  }

  async list(query: ListUsersQueryDto) {
    const limit = query.limit ?? 20;

    let result: { items: User[]; nextCursor?: string };

    if (query.roleId) {
      result = await this.repository.findByRoleId(query.roleId).then((items) => ({ items, nextCursor: undefined }));
    } else if (query.department) {
      result = await this.repository.findByDepartment(
        query.department,
        limit,
        query.cursor,
      );
    } else if (query.status) {
      result = await this.repository.findByStatus(
        query.status,
        limit,
        query.cursor,
      );
    } else {
      result = await this.repository.findAll(limit, query.cursor);
    }

    return {
      success: true as const,
      data: result.items,
      pagination: {
        nextCursor: result.nextCursor,
        count: result.items.length,
      },
    };
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    caller: JwtUser,
  ): Promise<User> {
    const existingUser = await this.findById(id);

    const updatedUser = await this.repository.update(id, dto);

    // Sync department to Cognito if changed
    if (dto.department) {
      await this.cognitoAdmin.updateUserAttributes(
        existingUser.cognitoSub,
        { 'custom:department': dto.department },
      );
    }

    await this.cache.invalidateUser(id);
    return updatedUser;
  }

  async deactivate(id: string, caller: JwtUser): Promise<void> {
    const user = await this.findById(id);

    if (caller.id === id) {
      throw new ForbiddenException('You cannot deactivate your own account');
    }

    await this.assertCallerCanManageUser(caller, user);

    await this.repository.update(id, { status: UserStatus.INACTIVE });
    await this.cognitoAdmin.disableUser(user.cognitoSub);
    await this.permissionCacheReader.setUserDisabled(id);
    await this.cache.invalidateUser(id);
  }

  async reactivate(id: string, caller: JwtUser): Promise<void> {
    const user = await this.findById(id);

    await this.assertCallerCanManageUser(caller, user);

    await this.repository.update(id, { status: UserStatus.ACTIVE });
    await this.cognitoAdmin.enableUser(user.cognitoSub);
    await this.permissionCacheReader.removeUserDisabled(id);
    await this.cache.invalidateUser(id);
    this.publishUserEvent('user.activated', user);
  }

  async resendInvite(id: string): Promise<void> {
    const user = await this.findById(id);
    await this.cognitoAdmin.resendInvite(user.email);
    this.logger.log(`Re-sent invitation email to ${user.email} (${id})`);
    this.publishUserEvent('user.invite-resent', user);
  }

  // --- Role Assignment ---

  async assignRole(
    userId: string,
    roleId: string,
    caller: JwtUser,
  ): Promise<User> {
    if (caller.id === userId) {
      throw new ForbiddenException('You cannot change your own role');
    }

    const targetUser = await this.findById(userId);
    const newRole = await this.rolesService.findById(roleId);
    const callerRoleId = await this.resolveCallerRoleId(caller);
    const callerRole = await this.rolesService.findById(callerRoleId);

    const isSuperAdmin = callerRole.isSystem && callerRole.name === 'Super Admin';
    if (!isSuperAdmin && callerRole.priority <= newRole.priority) {
      throw new ForbiddenException(
        'You cannot assign a role with equal or higher priority than your own',
      );
    }

    const targetCurrentRole = await this.rolesService.findById(targetUser.roleId);
    if (!isSuperAdmin && callerRole.priority <= targetCurrentRole.priority) {
      throw new ForbiddenException(
        'You cannot modify a user with a role of equal or higher priority than your own',
      );
    }

    // Last Super Admin protection
    if (targetUser.roleId === 'role-super-admin' && roleId !== 'role-super-admin') {
      const superAdminUsers = await this.repository.findByRoleId('role-super-admin');
      const activeSuperAdmins = superAdminUsers.filter(
        (u) => u.status === UserStatus.ACTIVE && u.id !== userId,
      );
      if (activeSuperAdmins.length === 0) {
        throw new ForbiddenException(
          'Cannot remove the last Super Admin. At least one active Super Admin must exist.',
        );
      }
    }

    const updatedUser = await this.repository.update(userId, {
      roleId,
      permissionOverrides: undefined,
    });

    await this.cognitoAdmin.updateUserAttributes(targetUser.cognitoSub, {
      'custom:role_id': roleId,
    });

    await this.cache.invalidateUser(userId);
    await this.rolesCache.invalidateUserPermissions(userId);

    this.publishUserEvent('user.role-changed', updatedUser);
    await this.ensureTechnicianProfile(userId, roleId);
    return updatedUser;
  }

  // --- Permission Overrides ---

  async setPermissionOverrides(
    userId: string,
    overrides: UserPermissionOverrides,
    caller: JwtUser,
  ): Promise<User> {
    const targetUser = await this.findById(userId);
    await this.assertCallerCanManageUser(caller, targetUser);

    // Convert class instance to plain object for DynamoDB marshalling
    const plainOverrides = JSON.parse(JSON.stringify(overrides));

    const updatedUser = await this.repository.update(userId, {
      permissionOverrides: plainOverrides,
    });

    await this.cache.invalidateUser(userId);
    await this.rolesCache.invalidateUserPermissions(userId);

    return updatedUser;
  }

  async clearPermissionOverrides(
    userId: string,
    caller: JwtUser,
  ): Promise<User> {
    const targetUser = await this.findById(userId);
    await this.assertCallerCanManageUser(caller, targetUser);

    const updatedUser = await this.repository.update(userId, {
      permissionOverrides: undefined,
    });

    await this.cache.invalidateUser(userId);
    await this.rolesCache.invalidateUserPermissions(userId);

    return updatedUser;
  }

  async getResolvedPermissions(userId: string): Promise<ResolvedPermissions> {
    const cached = await this.rolesCache.getUserPermissions(userId);
    if (cached) return cached;

    const user = await this.findById(userId);
    const role = await this.rolesService.findById(user.roleId);

    const resolved = this.permissionResolver.resolve(
      role,
      user.permissionOverrides,
    );

    await this.rolesCache.setUserPermissions(userId, resolved);

    return resolved;
  }

  // --- Private Helpers ---

  /**
   * Resolves the caller's roleId.
   * During the transition period, the JWT may not have `roleId` yet (old tokens).
   * In that case, look up the user record from DB to get their roleId.
   */
  private async resolveCallerRoleId(caller: JwtUser): Promise<string> {
    if (caller.roleId) return caller.roleId;

    // JWT has no roleId — look up from DB (old token, user already migrated)
    const callerUser = await this.findById(caller.id);
    if (callerUser.roleId) return callerUser.roleId;

    throw new ForbiddenException(
      'User has no roleId assigned. Run the migration script to update existing users.',
    );
  }

  /**
   * Onboarding step 1: when a user becomes a technician, provision a pending
   * technician profile so they appear in technician listings / onboarding
   * tracking immediately, before they self-fill their profile. Best-effort —
   * never fails the user mutation.
   */
  private async ensureTechnicianProfile(
    userId: string,
    roleId: string,
  ): Promise<void> {
    if (!this.techniciansRepository) return;
    if (roleId !== UsersService.TECHNICIAN_ROLE_ID) return;
    try {
      const existing = await this.techniciansRepository.getProfile(userId);
      if (existing) return;
      const now = new Date().toISOString();
      await this.techniciansRepository.upsertProfile({
        userId,
        callMaskingEnabled: false,
        gpsTrackingEnabled: false,
        mobileAppInstalled: false,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      });
      this.logger.log(`Provisioned pending technician profile for ${userId}`);
    } catch (err) {
      this.logger.warn(
        `Failed to provision technician profile for ${userId}: ${(err as Error).message}`,
      );
    }
  }

  private publishUserEvent(eventType: string, user: User): void {
    if (!this.snsPublisher) return;
    this.snsPublisher
      .publish('user-events', eventType, {
        userId: user.id,
        roleId: user.roleId,
        department: user.department,
        firstName: user.firstName,
        lastName: user.lastName,
      })
      .catch((err) =>
        this.logger.warn(`Failed to publish ${eventType}: ${err.message}`),
      );
  }

  private async assertCallerCanManageUser(
    caller: JwtUser,
    targetUser: User,
  ): Promise<void> {
    const callerRoleId = await this.resolveCallerRoleId(caller);
    const callerRole = await this.rolesService.findById(callerRoleId);
    const targetRole = await this.rolesService.findById(targetUser.roleId);

    if (callerRole.priority <= targetRole.priority) {
      throw new ForbiddenException(
        'You cannot manage a user with a role of equal or higher priority than your own',
      );
    }
  }
}
