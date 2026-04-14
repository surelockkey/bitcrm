import { randomUUID } from 'crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { CognitoAdminService, PermissionCacheReader, SnsPublisherService } from '@bitcrm/shared';
import {
  type User,
  type JwtUser,
  type UserPermissionOverrides,
  type ResolvedPermissions,
  UserStatus,
} from '@bitcrm/types';
import { UsersRepository } from './users.repository';
import { UsersCacheService } from './users-cache.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { RolesService } from '../roles/roles.service';
import { RolesCacheService } from '../roles/roles-cache.service';
import { PermissionResolverService } from '../roles/permission-resolver.service';

@Injectable()
export class UsersService {
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
  ) {}

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
    this.publishUserEvent('user.activated', user);
    return user;
  }

  async findById(id: string): Promise<User> {
    const cached = await this.cache.getUser(id);
    if (cached) return cached;

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

  private publishUserEvent(eventType: string, user: User): void {
    if (!this.snsPublisher) return;
    this.snsPublisher
      .publish('bitcrm-user-events', eventType, {
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
