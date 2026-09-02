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
import {
  CognitoAdminService,
  PermissionCacheReader,
  SnsPublisherService,
  BusinessMetricsService,
  normalizePhone,
  tryNormalizePhone,
} from '@bitcrm/shared';
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
import { TechnicianAssignmentsRepository } from '../technicians/assignments/technician-assignments.repository';
import { CommissionRepository } from '../technicians/commission/commission.repository';
import { buildDefaultCommission } from '../technicians/commission/commission.defaults';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { RolesService } from '../roles/roles.service';
import { RolesCacheService } from '../roles/roles-cache.service';
import { PermissionResolverService } from '../roles/permission-resolver.service';

/**
 * A technician's eligibility as deal-service projects it. Identity and approved
 * catalog ids travel together so the deal-service read-model can render and rank
 * the assignment dialog without calling back here.
 *
 * Mirrors `TechnicianEligibilityInfo` in deal-service's `internal-http.service.ts`.
 */
export interface TechnicianEligibilityInfo {
  technicianId: string;
  assignable: boolean;
  jobTypeIds: string[];
  serviceAreaIds: string[];
  firstName?: string;
  lastName?: string;
  department?: string;
  homeAddress?: { lat: number; lng: number };
}

/**
 * A teammate reduced to what a name join needs. Deliberately NOT a `Partial<User>`
 * — the point is that nothing else can be added by accident.
 */
export interface UserName {
  id: string;
  firstName: string;
  lastName: string;
}

/** One request may not sweep a generated id space. */
const MAX_NAME_LOOKUP = 200;

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
    private readonly assignmentsRepository?: TechnicianAssignmentsRepository,
  ) {}

  private static readonly TECHNICIAN_ROLE_ID = 'role-technician';

  /**
   * Every assignable technician, with identity and approved catalog ids.
   * deal-service projects this into its eligibility read-model on boot, and
   * matches deals against it by id — the reason the "qualified technicians"
   * list used to come back empty was that both sides compared free text
   * (`lock_change` against a hand-typed "Lock Change") instead.
   *
   * Assignable means ≥1 approved job type AND ≥1 approved service area, so
   * partially-onboarded technicians are left out.
   */
  async listAssignableTechnicians(): Promise<TechnicianEligibilityInfo[]> {
    if (!this.techniciansRepository || !this.assignmentsRepository) {
      // Returning [] quietly is how this endpoint's absence went unnoticed for so
      // long — deal-service swallowed the 404 and dispatch just looked empty. Say so.
      this.logger.error(
        'Technician repositories are not wired — dispatch will see no candidates',
      );
      return [];
    }

    const [users, jobTypes, areas, profiles] = await Promise.all([
      this.repository.findByRoleId(UsersService.TECHNICIAN_ROLE_ID),
      this.assignmentsRepository.listAllApproved('job_type'),
      this.assignmentsRepository.listAllApproved('service_area'),
      this.listAllTechnicianProfiles(),
    ]);

    const byTech = new Map<string, { jobTypeIds: string[]; serviceAreaIds: string[] }>();
    const bucket = (userId: string) => {
      const entry = byTech.get(userId) ?? { jobTypeIds: [], serviceAreaIds: [] };
      byTech.set(userId, entry);
      return entry;
    };
    for (const a of jobTypes) bucket(a.userId).jobTypeIds.push(a.catalogId);
    for (const a of areas) bucket(a.userId).serviceAreaIds.push(a.catalogId);

    const homeByTech = new Map(profiles.map((p) => [p.userId, p.homeAddress]));

    const technicians: TechnicianEligibilityInfo[] = [];
    for (const user of users) {
      const entry = byTech.get(user.id);
      if (!entry?.jobTypeIds.length || !entry.serviceAreaIds.length) continue;

      const home = homeByTech.get(user.id);
      const mappable = home?.lat !== undefined && home?.lng !== undefined;

      technicians.push({
        technicianId: user.id,
        assignable: true,
        jobTypeIds: entry.jobTypeIds,
        serviceAreaIds: entry.serviceAreaIds,
        firstName: user.firstName,
        lastName: user.lastName,
        department: user.department,
        homeAddress: mappable
          ? { lat: home.lat as number, lng: home.lng as number }
          : undefined,
      });
    }

    return technicians;
  }

  /** One technician's eligibility, in the same shape as the list above. */
  async getTechnicianEligibility(userId: string): Promise<TechnicianEligibilityInfo> {
    const unassignable: TechnicianEligibilityInfo = {
      technicianId: userId,
      assignable: false,
      jobTypeIds: [],
      serviceAreaIds: [],
    };
    if (!this.assignmentsRepository) return unassignable;

    const all = await this.assignmentsRepository.listByUser(userId);
    const approved = (kind: 'job_type' | 'service_area') =>
      all.filter((a) => a.kind === kind && a.status === 'approved').map((a) => a.catalogId);

    const jobTypeIds = approved('job_type');
    const serviceAreaIds = approved('service_area');
    if (!jobTypeIds.length || !serviceAreaIds.length) return unassignable;

    const [user, profile] = await Promise.all([
      this.repository.findById(userId),
      this.techniciansRepository?.getProfile(userId),
    ]);
    const home = profile?.homeAddress;
    const mappable = home?.lat !== undefined && home?.lng !== undefined;

    return {
      technicianId: userId,
      assignable: true,
      jobTypeIds,
      serviceAreaIds,
      firstName: user?.firstName,
      lastName: user?.lastName,
      department: user?.department,
      homeAddress: mappable ? { lat: home.lat as number, lng: home.lng as number } : undefined,
    };
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

    const phone = dto.phone ? await this.claimPhone(dto.phone, id) : undefined;

    const now = new Date().toISOString();
    const user: User = {
      id,
      cognitoSub,
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      roleId: dto.roleId,
      department: dto.department,
      ...(phone ? { phone } : {}),
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

  /**
   * Unfiltered, cursor-paginated user listing for internal consumers such as
   * the search-service backfill/indexer. Thin passthrough to the repository.
   */
  async findAll(
    limit: number,
    cursor?: string,
  ): Promise<{ items: User[]; nextCursor?: string }> {
    return this.repository.findAll(limit, cursor);
  }

  /**
   * Point a user's phone at `raw` (blank clears it), maintaining the lookup
   * index: claim the new number, then drop the old item so it stops
   * resolving. Returns the value to persist on the user.
   */
  private async applyPhoneChange(
    userId: string,
    currentPhone: string | undefined,
    raw: string,
  ): Promise<string | undefined> {
    const next = raw.trim() ? await this.claimPhone(raw, userId) : undefined;
    if (currentPhone && currentPhone !== next) {
      await this.repository.deletePhoneIndex(currentPhone);
    }
    return next;
  }

  /**
   * Set a person's phone — the only place a phone number is stored. Anyone may
   * set their own (a technician has no `users.edit` permission but must still
   * be reachable on their own number, which is the whole point of the field),
   * and the technician module routes its profile form here rather than keeping
   * a second copy. Authorization is the caller's job.
   */
  async setPhone(userId: string, raw: string): Promise<User> {
    const existing = await this.findById(userId);
    const phone = await this.applyPhoneChange(userId, existing.phone, raw);
    const updated = await this.repository.update(userId, { phone });
    await this.cache.invalidateUser(userId);
    return updated;
  }

  /**
   * Reserve a phone for a user: normalize, reject a number another user
   * already holds (the index maps one number to one person), and write the
   * lookup item. Returns the stored E.164 form.
   */
  private async claimPhone(raw: string, userId: string): Promise<string> {
    const phone = normalizePhone(raw);
    const owner = await this.repository.findByPhone(phone);
    if (owner && owner.id !== userId) {
      throw new ConflictException(
        `${phone} is already on ${owner.firstName} ${owner.lastName}'s profile`,
      );
    }
    await this.repository.putPhoneIndex(phone, userId);
    return phone;
  }

  /**
   * Resolve phone numbers to the users who own them — telephony asks this to
   * tell "we rang Nazarii's mobile" apart from "an unknown number called in".
   * Misses and unparseable input are simply absent from the map.
   */
  /**
   * Teammate names for ids the caller already holds.
   *
   * The narrow alternative to `users.view` for the screens that only need to
   * turn an id into something readable. A technician holds `users.view: false`,
   * so `GET /users` 403s for them and every name join falls back to rendering a
   * raw uuid — while they still legitimately need to see who else is on their
   * job.
   *
   * Three properties make this safe to expose to any authenticated user:
   *  - you must already HOLD the id, so there is nothing to enumerate;
   *  - the batch is capped, so a generated id space cannot be swept;
   *  - the shape is `{id, firstName, lastName}` and nothing else — in
   *    particular not a teammate's personal phone, which the call log treats
   *    as identifying.
   */
  async namesByIds(ids: string[]): Promise<UserName[]> {
    const wanted = [...new Set((ids ?? []).filter((id) => typeof id === 'string' && id))]
      .slice(0, MAX_NAME_LOOKUP);
    if (wanted.length === 0) return [];

    const found = await Promise.all(
      wanted.map((id) =>
        this.repository
          .findById(id)
          // One unreadable row must not cost the caller every other name.
          .catch(() => null),
      ),
    );

    return found
      .filter((u): u is NonNullable<typeof u> => Boolean(u))
      .map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName }));
  }

  async findManyByPhone(phones: string[]): Promise<Record<string, User>> {
    const wanted = new Map<string, string>(); // normalized -> raw input
    for (const raw of new Set(phones)) {
      const normalized = tryNormalizePhone(raw);
      if (normalized && !wanted.has(normalized)) wanted.set(normalized, raw);
    }

    const found = await Promise.all(
      [...wanted.keys()].map(async (normalized) => ({
        normalized,
        user: await this.repository.findByPhone(normalized),
      })),
    );

    const out: Record<string, User> = {};
    for (const { normalized, user } of found) {
      if (!user) continue;
      out[wanted.get(normalized) as string] = user;
      out[normalized] = user;
    }
    return out;
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    caller: JwtUser,
  ): Promise<User> {
    const existingUser = await this.findById(id);

    const attrs: Partial<User> & UpdateUserDto = { ...dto };
    if (dto.phone !== undefined) {
      attrs.phone = await this.applyPhoneChange(
        id,
        existingUser.phone,
        dto.phone,
      );
    }

    const updatedUser = await this.repository.update(id, attrs);

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

    // A PRIVACY RESTRICTION SURVIVES A ROLE CHANGE; A PRIVACY EXEMPTION DOES
    // NOT. Every other override still drops, exactly as before — but a masked
    // technician promoted to dispatcher would otherwise silently regain every
    // client's number, which is a privacy regression nobody would notice until
    // it mattered.
    const carried = await this.carryForwardPrivacy(targetUser, roleId);

    const updatedUser = await this.repository.update(userId, {
      roleId,
      permissionOverrides: carried,
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

  /**
   * Keep a masking restriction across a role change.
   *
   * Only ever carries a DENIAL forward, and only when the incoming role would
   * grant it — so this can quietly restrict, never quietly widen. Returns
   * undefined (drop everything, as before) when there is nothing to keep.
   */
  private async carryForwardPrivacy(
    user: User,
    incomingRoleId: string,
  ): Promise<User['permissionOverrides']> {
    const wasDenied =
      user.permissionOverrides?.permissions?.contacts?.view_numbers === false;
    if (!wasDenied) return undefined;

    const incoming = await this.rolesService.findById(incomingRoleId).catch(() => null);
    if (incoming?.permissions?.contacts?.view_numbers !== true) return undefined;

    this.logger.log(
      `Carrying the client-number restriction forward for ${user.id} into ${incomingRoleId}`,
    );
    return { permissions: { contacts: { view_numbers: false } } };
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
