import { UserStatus, DataScope, type User, type JwtUser, type Role } from '@bitcrm/types';
import type { CreateUserDto } from '../../src/users/dto/create-user.dto';
import type { UpdateUserDto } from '../../src/users/dto/update-user.dto';

export function createMockUser(overrides?: Partial<User>): User {
  return {
    id: 'user-1',
    cognitoSub: 'cognito-sub-1',
    email: 'test@example.com',
    firstName: 'John',
    lastName: 'Doe',
    roleId: 'role-technician',
    permissionOverrides: undefined,
    department: 'HVAC',
    status: UserStatus.ACTIVE,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function createMockJwtUser(overrides?: Partial<JwtUser>): JwtUser {
  return {
    id: 'caller-1',
    cognitoSub: 'cognito-sub-caller',
    email: 'admin@example.com',
    roleId: 'role-admin',
    department: 'Engineering',
    ...overrides,
  };
}

export function createMockCreateUserDto(
  overrides?: Partial<CreateUserDto>,
): CreateUserDto {
  return {
    email: 'new@example.com',
    firstName: 'Jane',
    lastName: 'Smith',
    roleId: 'role-technician',
    department: 'HVAC',
    ...overrides,
  } as CreateUserDto;
}

export function createMockUpdateUserDto(
  overrides?: Partial<UpdateUserDto>,
): UpdateUserDto {
  return {
    ...overrides,
  } as UpdateUserDto;
}

export function createMockUsersRepository() {
  return {
    create: jest.fn(),
    findById: jest.fn(),
    findByRole: jest.fn(),
    findByDepartment: jest.fn(),
    findAll: jest.fn(),
    findByStatus: jest.fn(),
    update: jest.fn(),
  };
}

export function createMockUsersCacheService() {
  return {
    getUser: jest.fn(),
    setUser: jest.fn(),
    invalidateUser: jest.fn(),
  };
}

export function createMockCognitoAdminService() {
  return {
    createUser: jest.fn(),
    updateUserAttributes: jest.fn(),
    disableUser: jest.fn(),
    enableUser: jest.fn(),
    deleteUser: jest.fn(),
  };
}

export function createMockRedisClient() {
  return {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };
}

export function createMockDynamoDbClient() {
  return {
    send: jest.fn(),
  };
}

export function createMockRole(overrides?: Partial<Role>): Role {
  return {
    id: 'role-1',
    name: 'Test Role',
    description: 'A test role',
    permissions: {
      deals: { view: true, create: true, edit: false, delete: false },
      contacts: { view: true, create: false, edit: false, delete: false },
    },
    dataScope: { deals: DataScope.ALL, contacts: DataScope.DEPARTMENT },
    dealStageTransitions: ['lead->qualified', '*->canceled'],
    isSystem: false,
    priority: 50,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function createMockRolesRepository() {
  return {
    create: jest.fn(),
    findById: jest.fn(),
    findAll: jest.fn(),
    findByName: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
}

export function createMockPermissionCacheReader() {
  return {
    getPermissions: jest.fn(),
    isUserDisabled: jest.fn().mockResolvedValue(false),
    setUserDisabled: jest.fn().mockResolvedValue(undefined),
    removeUserDisabled: jest.fn().mockResolvedValue(undefined),
  };
}

export function createMockRolesCacheService() {
  return {
    getRolePermissions: jest.fn(),
    setRolePermissions: jest.fn(),
    invalidateRole: jest.fn(),
    getUserPermissions: jest.fn(),
    setUserPermissions: jest.fn(),
    invalidateUserPermissions: jest.fn(),
    invalidateAllUsersWithRole: jest.fn(),
  };
}

export function createMockPermissionResolver() {
  return {
    resolve: jest.fn(),
  };
}
