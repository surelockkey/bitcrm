import {
  UserStatus,
  DataScope,
  type User,
  type JwtUser,
  type Role,
  type TechnicianProfile,
} from '@bitcrm/types';
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
    findByRoleId: jest.fn().mockResolvedValue([]),
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
    resendInvite: jest.fn().mockResolvedValue(undefined),
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

// --- Technicians ---

export function createMockTechnicianProfile(
  overrides?: Partial<TechnicianProfile>,
): TechnicianProfile {
  return {
    userId: 'tech-1',
    phone: '404-555-0123',
    callMaskingEnabled: false,
    gpsTrackingEnabled: false,
    mobileAppInstalled: false,
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function createMockTechniciansRepository() {
  return {
    getProfile: jest.fn(),
    upsertProfile: jest.fn(),
    updateProfile: jest.fn(),
    listAll: jest.fn(),
    listByStatus: jest.fn(),
  };
}

export function createMockTechniciansCacheService() {
  return {
    getProfile: jest.fn(),
    setProfile: jest.fn(),
    invalidateProfile: jest.fn(),
  };
}

export function createMockSnsPublisher() {
  return {
    publish: jest.fn().mockResolvedValue(undefined),
  };
}

export function createMockTechnicianSkill(
  overrides?: Partial<import('@bitcrm/types').TechnicianSkill>,
): import('@bitcrm/types').TechnicianSkill {
  return {
    skillId: 'sk-1',
    userId: 'tech-1',
    type: 'job_type',
    value: 'Locksmith',
    status: 'pending',
    proposedBy: 'tech-1',
    proposedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function createMockTechnicianSkillsRepository() {
  return {
    create: jest.fn(),
    getById: jest.fn(),
    listByUser: jest.fn().mockResolvedValue([]),
    listPendingAcrossTechs: jest.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
    listAllApproved: jest.fn().mockResolvedValue([]),
    updateStatus: jest.fn(),
    delete: jest.fn(),
  };
}

export function createMockCommissionRepository() {
  return {
    create: jest.fn(),
    getLatest: jest.fn(),
    listHistory: jest.fn().mockResolvedValue([]),
  };
}

export function createMockS3Service() {
  return {
    getPresignedUpload: jest.fn().mockResolvedValue({
      url: 'https://s3/upload',
      headers: { 'Content-Type': 'image/png' },
    }),
    getPresignedUploadUrl: jest.fn().mockResolvedValue('https://s3/upload'),
    getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://s3/download'),
    deleteObject: jest.fn().mockResolvedValue(undefined),
  };
}

export function createMockKmsService() {
  return {
    encrypt: jest.fn(async (p: string) => `ENC(${p})`),
    decrypt: jest.fn(async (c: string) => c.replace(/^ENC\((.*)\)$/, '$1')),
    mask: jest.fn((v: string, n = 4) =>
      !v ? '' : v.length <= n ? '•'.repeat(v.length) : '•'.repeat(v.length - n) + v.slice(-n),
    ),
  };
}

export function createMockDocumentsRepository() {
  return {
    upsert: jest.fn(),
    getByType: jest.fn(),
    listByUser: jest.fn().mockResolvedValue([]),
    delete: jest.fn(),
  };
}

export function createMockSensitiveRepository() {
  return {
    upsert: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
  };
}

export function createMockAuditRepository() {
  return {
    record: jest.fn().mockResolvedValue(undefined),
    listByUser: jest.fn().mockResolvedValue([]),
  };
}

export function createMockCommissionConfig(
  overrides?: Partial<import('@bitcrm/types').CommissionConfig>,
): import('@bitcrm/types').CommissionConfig {
  return {
    userId: 'tech-1',
    baseRatePct: 40,
    creditCardFeePct: 3,
    achFeePct: 0,
    effectiveDate: '2026-01-01T00:00:00.000Z',
    createdBy: 'mgr-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * RolesService.findById mock seeded with the system roles + their priorities,
 * so service-layer priority checks can be exercised in unit tests.
 */
export function createMockRolesServiceByPriority() {
  const roles: Record<string, Partial<Role>> = {
    'role-super-admin': { id: 'role-super-admin', name: 'Super Admin', isSystem: true, priority: 100 },
    'role-admin': { id: 'role-admin', name: 'Admin', isSystem: true, priority: 80 },
    'role-dept-manager': { id: 'role-dept-manager', name: 'Department Manager', isSystem: true, priority: 60 },
    'role-dispatcher': { id: 'role-dispatcher', name: 'Dispatcher', isSystem: true, priority: 40 },
    'role-technician': { id: 'role-technician', name: 'Technician', isSystem: true, priority: 20 },
    'role-read-only': { id: 'role-read-only', name: 'Read Only', isSystem: true, priority: 10 },
  };
  return {
    findById: jest.fn(async (id: string) => {
      const role = roles[id];
      if (!role) throw new Error(`role ${id} not found`);
      return role as Role;
    }),
  };
}
