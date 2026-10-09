import { randomUUID } from 'crypto';
import {
  BadRequestException,
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
  RedisService,
  cachedCount,
  countCacheKey,
  type CountRowsResult,
} from '@bitcrm/shared';
import {
  type User,
  type JwtUser,
  type UserPermissionOverrides,
  type ResolvedPermissions,
  isAssignableTechnician,
  isFieldTeamMember,
  isSubcontractor,
  TechChangedField,
  TECHNICIAN_ROLE_ID,
  UserEventType,
  UserStatus,
  type ListCount,
  type UserType,
} from '@bitcrm/types';
import { UsersRepository } from './users.repository';
import { UsersCacheService } from './users-cache.service';
import { TechniciansRepository } from '../technicians/technicians.repository';
import { TechniciansCacheService } from '../technicians/technicians-cache.service';
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
  /** Workiz's whole name for the person, when the import left one (`User.workizName`). */
  workizName?: string;
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
  /**
   * Workiz's whole name for the person ("(2) TX - Daniel Munoz") — a name, not
   * a detail: it is what Workiz prints on their chip. Only when there is one.
   */
  workizName?: string;
}

/** One request may not sweep a generated id space. */
const MAX_NAME_LOOKUP = 200;

/** The keys a request actually carried — see `update`. */
function withoutUndefined<T extends object>(o: T): T {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined),
  ) as T;
}

/** Whether an edit changes the person's first or last name. */
function isRename(
  existing: Pick<User, 'firstName' | 'lastName'>,
  dto: Pick<UpdateUserDto, 'firstName' | 'lastName'>,
): boolean {
  return (
    (dto.firstName !== undefined && dto.firstName !== existing.firstName) ||
    (dto.lastName !== undefined && dto.lastName !== existing.lastName)
  );
}

/** How long a list count stays good enough. Matches the deals tab counts. */
const COUNT_TTL_SECONDS = 30;
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
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly techniciansCache?: TechniciansCacheService,
  ) {}

  /**
   * Every assignable technician, with identity and approved catalog ids.
   * deal-service projects this into its eligibility read-model on boot, and
   * matches deals against it by id — the reason the "qualified technicians"
   * list used to come back empty was that both sides compared free text
   * (`lock_change` against a hand-typed "Lock Change") instead.
   *
   * This roster is also the authority deal-service reconciles against, so it
   * must be the complete set: a technician left out here is removed from the
   * assignment dialog on deal-service's next boot.
   *
   * "Assignable" is `isAssignableTechnician` and nothing else — see
   * `getTechnicianEligibility`, which answers the same question for one user.
   * It reads every user, not every technician: the field-team flag that puts
   * someone on this roster sits on the user record, whatever their role.
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
      this.listAllUsers(),
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
      const entry = byTech.get(user.id) ?? { jobTypeIds: [], serviceAreaIds: [] };
      if (!isAssignableTechnician(user)) continue;

      const home = homeByTech.get(user.id);
      const mappable = home?.lat !== undefined && home?.lng !== undefined;

      technicians.push({
        technicianId: user.id,
        assignable: true,
        jobTypeIds: entry.jobTypeIds,
        serviceAreaIds: entry.serviceAreaIds,
        firstName: user.firstName,
        lastName: user.lastName,
        ...(user.workizName && { workizName: user.workizName }),
        department: user.department,
        homeAddress: mappable
          ? { lat: home.lat as number, lng: home.lng as number }
          : undefined,
      });
    }

    return technicians;
  }

  /**
   * One user's eligibility, by the same rule as the roster above — the two
   * used to disagree, and this was the looser of the pair: it read the approved
   * job types and service areas and never asked whose they were, so approving a
   * job type for a dispatcher published `tech.approved` and put them in the
   * assignment dialog as a technician.
   *
   * Answers for any user id, not only technicians: deal-service asks this on a
   * role change or a deactivation precisely to hear "no longer assignable".
   */
  async getTechnicianEligibility(userId: string): Promise<TechnicianEligibilityInfo> {
    const unassignable: TechnicianEligibilityInfo = {
      technicianId: userId,
      assignable: false,
      jobTypeIds: [],
      serviceAreaIds: [],
    };
    if (!this.assignmentsRepository) return unassignable;

    const [all, user] = await Promise.all([
      this.assignmentsRepository.listByUser(userId),
      // A deleted or unknown user is not a technician; `findById` here is the
      // repository's (null-returning) one, not the service's throwing wrapper.
      this.repository.findById(userId),
    ]);
    const approved = (kind: 'job_type' | 'service_area') =>
      all.filter((a) => a.kind === kind && a.status === 'approved').map((a) => a.catalogId);

    const jobTypeIds = approved('job_type');
    const serviceAreaIds = approved('service_area');
    if (!isAssignableTechnician(user)) return unassignable;

    const profile = await this.techniciansRepository?.getProfile(userId);
    const home = profile?.homeAddress;
    const mappable = home?.lat !== undefined && home?.lng !== undefined;

    return {
      technicianId: userId,
      assignable: true,
      jobTypeIds,
      serviceAreaIds,
      firstName: user?.firstName,
      lastName: user?.lastName,
      ...(user?.workizName && { workizName: user.workizName }),
      department: user?.department,
      homeAddress: mappable ? { lat: home.lat as number, lng: home.lng as number } : undefined,
    };
  }

  /**
   * Every user, cursor-drained, for the dispatch roster. Bounded the same way
   * as the profiles below.
   */
  private async listAllUsers(): Promise<User[]> {
    const all: User[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.repository.findAll(200, cursor);
      all.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor && all.length < 5000);
    return all;
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
        TECHNICIAN_ROLE_ID,
        200,
        cursor,
      );
      for (const user of items) {
        const existing = await this.techniciansRepository.getProfile(user.id);
        if (!existing) {
          await this.ensureTechnicianProfile(user);
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
    // A Workiz subcontractor has no role to choose — Workiz prints "Tech",
    // greyed — and no sign-in: the account exists (the address stays theirs,
    // and they can be made a User later) but nobody is invited to it.
    const subcontractor = dto.userType === 'subcontractor';
    const roleId = subcontractor ? TECHNICIAN_ROLE_ID : dto.roleId;

    // Validate the role exists
    const newRole = await this.rolesService.findById(roleId);

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
      const claims = {
        'custom:role_id': roleId,
        'custom:department': dto.department,
        'custom:user_id': id,
      };
      const cognitoResult = subcontractor
        ? await this.cognitoAdmin.createUser(dto.email, claims, { suppressInvite: true })
        : await this.cognitoAdmin.createUser(dto.email, claims);
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
    if (subcontractor) await this.switchOffSignIn(id, cognitoSub, { sessions: false });

    const phone = dto.phone ? await this.claimPhone(dto.phone, id) : undefined;

    const now = new Date().toISOString();
    const user: User = {
      id,
      cognitoSub,
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      roleId,
      department: dto.department,
      ...(phone ? { phone } : {}),
      // "Can take jobs and get messages" — on the field team from the start.
      ...(subcontractor ? { userType: 'subcontractor' as const, fieldTeamMember: true } : {}),
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
    await this.ensureTechnicianProfile(user);
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

  /**
   * How many users the list holds — the number behind "Page 2 of 7".
   *
   * It branches exactly as `list` does. The role branch needs no count at all:
   * `findByRoleId` already returns the whole role, so its length is the answer
   * and an index walk would be waste.
   */
  async count(query: ListUsersQueryDto): Promise<ListCount> {
    const search = query.search?.trim();
    if (search) {
      // The matches themselves: a search pages them, so it counts them too.
      return { total: (await this.searchMatches(query, search)).length, atLeast: false };
    }
    // `CountRowsResult`, not `ListCount`: the directory always has a number,
    // and `cachedCount` will not take the nullable form that billing needs.
    const take = async (): Promise<CountRowsResult> => {
      if (query.roleId) {
        const items = await this.repository.findByRoleId(query.roleId);
        return { total: items.length, atLeast: false };
      }
      if (query.department) return this.repository.countByDepartment(query.department);
      if (query.status) return this.repository.countByStatus(query.status);
      return this.repository.countAll();
    };

    if (!this.redis) return take();
    return cachedCount(
      this.redis.client,
      countCacheKey('users', {
        roleId: query.roleId,
        department: query.department,
        status: query.status,
      }),
      COUNT_TTL_SECONDS,
      take,
    );
  }

  async list(query: ListUsersQueryDto) {
    const limit = query.limit ?? 20;
    const search = query.search?.trim();
    if (search) return this.searchPage(query, search, limit);

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
   * Search on the Users page: the whole directory, not the page on screen.
   * The directory is a team (hundreds, not millions), so it is read once
   * (`listAllUsers`, the same walk dispatch uses), filtered by the page's
   * role / department / status and every word of the search, sorted by name
   * and paged by offset. The cursor says it came from here.
   */
  private async searchPage(query: ListUsersQueryDto, search: string, limit: number) {
    const offset = searchOffset(query.cursor);
    const matches = await this.searchMatches(query, search);
    const items = matches.slice(offset, offset + limit);
    const next = offset + limit < matches.length ? `${SEARCH_CURSOR}${offset + limit}` : undefined;
    return {
      success: true as const,
      data: items,
      pagination: { nextCursor: next, count: items.length },
    };
  }

  private async searchMatches(query: ListUsersQueryDto, search: string): Promise<User[]> {
    const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
    const all = await this.listAllUsers();
    return all
      .filter((u) => !query.roleId || u.roleId === query.roleId)
      .filter((u) => !query.department || u.department === query.department)
      .filter((u) => !query.status || u.status === query.status)
      .filter((u) => matchesSearch(u, terms))
      .sort(
        (a, b) =>
          `${a.firstName ?? ''} ${a.lastName ?? ''}`.localeCompare(`${b.firstName ?? ''} ${b.lastName ?? ''}`, 'en', {
            sensitivity: 'base',
          }) || a.id.localeCompare(b.id),
      );
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
    const updated = await this.repository.update(userId, {
      phone,
      ...mfaAfterPhoneChange(existing, phone),
    });
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
      .map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        ...(u.workizName && { workizName: u.workizName }),
      }));
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
    // A type change is checked before anything is written: an edit that may
    // not take someone's sign-in away must not half-happen either.
    const typeChange =
      dto.userType !== undefined && dto.userType !== (existingUser.userType ?? 'regular')
        ? dto.userType
        : undefined;
    if (typeChange) await this.assertCanChangeUserType(caller, existingUser);

    // What ValidationPipe hands over is a class instance, and an ES2022 class
    // field that was never sent is still an own property — holding undefined.
    // The repository reads an explicit undefined as "remove this attribute",
    // which is right for the cleared phone below and wrong for everything a
    // partial update simply did not mention: spread as-is, one
    // `PUT { fieldTeamMember }` wiped a person's name, department and phone.
    const attrs: Partial<User> & UpdateUserDto = withoutUndefined(dto);
    // The type is never written as a plain attribute — `changeUserType` moves
    // the sign-in with it.
    delete attrs.userType;
    // Renamed here, the person is no longer who Workiz's whole name says — so
    // that name goes, or every chip would print the old one for good. An
    // explicit undefined is the repository's REMOVE.
    const renamed = isRename(existingUser, dto);
    if (renamed && existingUser.workizName) attrs.workizName = undefined;
    if (dto.phone !== undefined) {
      attrs.phone = await this.applyPhoneChange(
        id,
        existingUser.phone,
        dto.phone,
      );
      Object.assign(attrs, mfaAfterPhoneChange(existingUser, attrs.phone));
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

    // On or off the field team is the one edit here that moves someone in or
    // out of dispatch. Switching it on also gives them the technician card's
    // fields; switching it off keeps the profile — the address and hours are
    // still theirs, they just stop being offered on jobs.
    if (dto.fieldTeamMember !== undefined) {
      await this.ensureTechnicianProfile(updatedUser);
      this.publishTechUpdated(id, TechChangedField.FIELD_TEAM);
    }
    // deal-service's technician projection prints the name (jobs list, Assign
    // A Tech); without this it kept the old one until its next boot.
    if (renamed) this.publishTechUpdated(id, TechChangedField.NAME);
    if (typeChange) return this.changeUserType(id, typeChange, caller);
    return updatedUser;
  }

  /**
   * Workiz's "User type", and what goes with it. To `subcontractor`: the
   * sign-in goes at once — the Cognito account off (no new sessions) and the
   * `user:disabled` flag set (the sessions already open are refused by the
   * guard on their next request) — and the card stops tracking their location.
   * Back to `regular`: the sign-in comes back, if the person is active, with
   * the invitation re-sent (a person who already has a password simply keeps
   * it). The technician card's copy of the type is kept in step either way.
   *
   * Only someone who outranks the person, and never on yourself — this is a
   * way to lock someone out.
   */
  async changeUserType(id: string, type: UserType, caller: JwtUser): Promise<User> {
    const user = await this.findById(id);
    if ((user.userType ?? 'regular') === type) return user;
    await this.assertCanChangeUserType(caller, user);

    const updated = await this.repository.update(id, { userType: type });
    if (type === 'subcontractor') {
      await this.switchOffSignIn(id, user.cognitoSub, { sessions: true });
    } else if (user.status !== UserStatus.INACTIVE) {
      await this.cognitoAdmin.enableUser(user.cognitoSub);
      await this.permissionCacheReader.removeUserDisabled(id);
      await this.cognitoAdmin.resendInvite(user.email).catch((err: Error) =>
        this.logger.log(
          `No invitation re-sent to ${id} on becoming a User (${err.name}): they keep their password`,
        ),
      );
    }
    await this.cache.invalidateUser(id);
    await this.mirrorTypeOnCard(id, type);
    this.logger.log(`User ${id} is now ${type === 'subcontractor' ? 'a subcontractor' : 'a User'}`);
    return updated;
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
    // Nobody who cannot log in should still be offered for tomorrow's work.
    this.publishTechUpdated(id, TechChangedField.STATUS);
  }

  async reactivate(id: string, caller: JwtUser): Promise<void> {
    const user = await this.findById(id);

    await this.assertCallerCanManageUser(caller, user);

    await this.repository.update(id, { status: UserStatus.ACTIVE });
    // A subcontractor comes back to the team, not to the sign-in page.
    if (!isSubcontractor(user)) {
      await this.cognitoAdmin.enableUser(user.cognitoSub);
      await this.permissionCacheReader.removeUserDisabled(id);
    }
    await this.cache.invalidateUser(id);
    this.publishUserEvent('user.activated', user);
    this.publishTechUpdated(id, TechChangedField.STATUS);
  }

  async resendInvite(id: string): Promise<void> {
    const user = await this.findById(id);
    if (isSubcontractor(user)) {
      throw new BadRequestException(
        'A subcontractor cannot sign in, so there is no invitation to send. Make them a User first.',
      );
    }
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
    // Workiz: "Roles are not available for subcontractors."
    if (isSubcontractor(targetUser)) {
      throw new BadRequestException(
        'Roles are not available for subcontractors. Make them a User first.',
      );
    }
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
    // `user.role-changed` is a user-shaped event nobody joins to dispatch. A
    // technician demoted to dispatcher otherwise stayed in the assignment
    // dialog until deal-service happened to restart.
    this.publishTechUpdated(userId, TechChangedField.ROLE);
    await this.ensureTechnicianProfile(updatedUser);
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
   * Onboarding step 1: when a user joins the field team — by taking the
   * technician role, or by the flag being switched on for any role —
   * provision a pending technician profile so they appear in technician
   * listings / onboarding tracking immediately, before anyone fills it in.
   * Best-effort — never fails the user mutation.
   */
  private async ensureTechnicianProfile(
    user: Pick<User, 'id' | 'roleId' | 'fieldTeamMember' | 'userType'>,
  ): Promise<void> {
    if (!this.techniciansRepository) return;
    if (!isFieldTeamMember(user)) return;
    const userId = user.id;
    try {
      const existing = await this.techniciansRepository.getProfile(userId);
      if (existing) return;
      const now = new Date().toISOString();
      await this.techniciansRepository.upsertProfile({
        userId,
        ...(isSubcontractor(user) ? { technicianType: 'subcontractor' as const } : {}),
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

  /**
   * Tell the consumers of the eligibility projection to re-read this user.
   * Published for anyone, technician or not: "this person is not a technician"
   * is exactly the answer that takes a stale row out of the assignment dialog.
   */
  private publishTechUpdated(userId: string, changed: TechChangedField): void {
    if (!this.snsPublisher) return;
    this.snsPublisher
      .publish('user-events', UserEventType.TECH_UPDATED, {
        technicianId: userId,
        changedFields: [changed],
      })
      .catch((err) =>
        this.logger.warn(`Failed to publish tech.updated (${changed}): ${err.message}`),
      );
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

  /** Changing the user type can lock someone out: never yourself, only below you. */
  private async assertCanChangeUserType(caller: JwtUser, user: User): Promise<void> {
    if (caller.id === user.id) {
      throw new ForbiddenException('You cannot change your own user type');
    }
    await this.assertCallerCanManageUser(caller, user);
  }

  /**
   * No sign-in for this person: the Cognito account off and — when they may
   * hold sessions already — the flag the auth guard refuses them by. A failure
   * is logged, not thrown: the person is a subcontractor either way, and an
   * account made for one has no password anyone knows.
   */
  private async switchOffSignIn(
    id: string,
    cognitoSub: string,
    { sessions }: { sessions: boolean },
  ): Promise<void> {
    try {
      await this.cognitoAdmin.disableUser(cognitoSub);
      if (sessions) await this.permissionCacheReader.setUserDisabled(id);
    } catch (err) {
      this.logger.warn(`Could not switch off the sign-in of subcontractor ${id}: ${(err as Error).message}`);
    }
  }

  /**
   * The technician card keeps a copy of the type (the Team list reads it off
   * the card), and a subcontractor's location is not tracked (Workiz: "You
   * will not be able to enable location tracking for subcontractors").
   * Best-effort: the user record is the truth, and the card reads it back.
   */
  private async mirrorTypeOnCard(id: string, type: UserType): Promise<void> {
    if (!this.techniciansRepository) return;
    try {
      const profile = await this.techniciansRepository.getProfile(id);
      if (!profile) return;
      await this.techniciansRepository.updateProfile(id, {
        technicianType: type,
        ...(type === 'subcontractor' && profile.gpsTrackingEnabled
          ? { gpsTrackingEnabled: false }
          : {}),
      });
      await this.techniciansCache?.invalidateProfile(id);
    } catch (err) {
      this.logger.warn(`Could not update the technician card of ${id}: ${(err as Error).message}`);
    }
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

/**
 * Two-step sign-in is proved against one number. A new number — or none —
 * has proved nothing, so the second step goes off until the new one does.
 */
function mfaAfterPhoneChange(
  user: Pick<User, 'phone' | 'smsMfaEnabled'>,
  phone: string | undefined,
): Partial<User> {
  return user.smsMfaEnabled && user.phone !== phone ? { smsMfaEnabled: false } : {};
}

/** A search page's cursor: where the next page starts in the sorted matches. */
const SEARCH_CURSOR = 'search:';

function searchOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  const n = cursor.startsWith(SEARCH_CURSOR) ? Number(cursor.slice(SEARCH_CURSOR.length)) : NaN;
  if (!Number.isInteger(n) || n < 0) throw new BadRequestException('Invalid cursor for a search');
  return n;
}

/**
 * Every word of the search appears somewhere in the user's name, email,
 * department or phone, ignoring case; a word of digits also matches the
 * phone with its punctuation stripped ("5550123" finds "(404) 555-0123").
 */
export function matchesSearch(u: Pick<User, 'firstName' | 'lastName' | 'email' | 'department' | 'phone'>, terms: string[]): boolean {
  const hay = [u.firstName, u.lastName, u.email, u.department, u.phone].filter(Boolean).join(' ').toLowerCase();
  const phoneDigits = (u.phone ?? '').replace(/\D/g, '');
  return terms.every((t) => {
    if (hay.includes(t)) return true;
    const digits = t.replace(/\D/g, '');
    return digits.length >= 3 && digits === t.replace(/[\s()+.-]/g, '') && phoneDigits.includes(digits);
  });
}
