import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CognitoAdminService, PermissionCacheReader } from '@bitcrm/shared';
import { UsersService } from '../../../src/users/users.service';
import { UsersRepository } from '../../../src/users/users.repository';
import { UsersCacheService } from '../../../src/users/users-cache.service';
import { RolesService } from '../../../src/roles/roles.service';
import { RolesCacheService } from '../../../src/roles/roles-cache.service';
import { PermissionResolverService } from '../../../src/roles/permission-resolver.service';
import { TechniciansRepository } from '../../../src/technicians/technicians.repository';
import { CommissionRepository } from '../../../src/technicians/commission/commission.repository';
import {
  createMockUser,
  createMockJwtUser,
  createMockCreateUserDto,
  createMockRole,
  createMockUsersRepository,
  createMockUsersCacheService,
  createMockCognitoAdminService,
  createMockRolesCacheService,
  createMockPermissionResolver,
  createMockPermissionCacheReader,
  createMockTechniciansRepository,
  createMockCommissionRepository,
} from '../mocks';

describe('UsersService → technician profile auto-provisioning', () => {
  let service: UsersService;
  let techRepo: ReturnType<typeof createMockTechniciansRepository>;
  let usersRepo: ReturnType<typeof createMockUsersRepository>;
  let commissionRepo: ReturnType<typeof createMockCommissionRepository>;

  beforeEach(async () => {
    usersRepo = createMockUsersRepository();
    techRepo = createMockTechniciansRepository();
    commissionRepo = createMockCommissionRepository();
    const cognito = createMockCognitoAdminService();

    const roles = {
      findById: jest.fn().mockImplementation((id: string) => {
        const map: Record<string, unknown> = {
          'role-super-admin': createMockRole({ id: 'role-super-admin', name: 'Super Admin', priority: 100, isSystem: true }),
          'role-admin': createMockRole({ id: 'role-admin', name: 'Admin', priority: 80, isSystem: true }),
          'role-technician': createMockRole({ id: 'role-technician', name: 'Technician', priority: 20 }),
          'role-read-only': createMockRole({ id: 'role-read-only', name: 'Read Only', priority: 10 }),
        };
        if (map[id]) return Promise.resolve(map[id]);
        return Promise.reject(new NotFoundException());
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: usersRepo },
        { provide: UsersCacheService, useValue: createMockUsersCacheService() },
        { provide: CognitoAdminService, useValue: cognito },
        { provide: PermissionCacheReader, useValue: createMockPermissionCacheReader() },
        { provide: RolesService, useValue: roles },
        { provide: RolesCacheService, useValue: createMockRolesCacheService() },
        { provide: PermissionResolverService, useValue: createMockPermissionResolver() },
        { provide: TechniciansRepository, useValue: techRepo },
        { provide: CommissionRepository, useValue: commissionRepo },
      ],
    }).compile();

    service = module.get(UsersService);

    usersRepo.create.mockResolvedValue(undefined);
    usersRepo.update.mockResolvedValue(createMockUser({ roleId: 'role-technician' }));
    usersRepo.findById.mockResolvedValue(createMockUser({ roleId: 'role-technician' }));
    cognito.createUser.mockResolvedValue({ User: { Attributes: [{ Name: 'sub', Value: 'sub-1' }] } });
    techRepo.getProfile.mockResolvedValue(null);
  });

  it('provisions a pending technician profile when creating a technician', async () => {
    await service.create(
      createMockCreateUserDto({ roleId: 'role-technician' }),
      createMockJwtUser({ roleId: 'role-super-admin' }),
    );

    expect(techRepo.getProfile).toHaveBeenCalled();
    expect(techRepo.upsertProfile).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', callMaskingEnabled: false }),
    );
  });

  it('does NOT provision a profile for a non-technician role', async () => {
    await service.create(
      createMockCreateUserDto({ roleId: 'role-admin' }),
      createMockJwtUser({ roleId: 'role-super-admin' }),
    );
    expect(techRepo.upsertProfile).not.toHaveBeenCalled();
  });

  it('does not duplicate an existing profile', async () => {
    techRepo.getProfile.mockResolvedValue({ userId: 'x', status: 'active' });
    await service.create(
      createMockCreateUserDto({ roleId: 'role-technician' }),
      createMockJwtUser({ roleId: 'role-super-admin' }),
    );
    expect(techRepo.upsertProfile).not.toHaveBeenCalled();
  });

  it('backfills profiles for existing technician users on module init', async () => {
    usersRepo.findByRole.mockResolvedValue({
      items: [
        createMockUser({ id: 'existing-tech', roleId: 'role-technician' }),
        createMockUser({ id: 'has-profile', roleId: 'role-technician' }),
      ],
      nextCursor: undefined,
    });
    techRepo.getProfile.mockImplementation((id: string) =>
      Promise.resolve(id === 'has-profile' ? { userId: id, status: 'active' } : null),
    );

    await service.onModuleInit();

    expect(usersRepo.findByRole).toHaveBeenCalledWith('role-technician', expect.any(Number), undefined);
    expect(techRepo.upsertProfile).toHaveBeenCalledTimes(1);
    expect(techRepo.upsertProfile).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'existing-tech', status: 'pending' }),
    );
  });

  it('backfills a default commission (40/3/0) for technicians lacking one on init', async () => {
    usersRepo.findByRole.mockResolvedValue({
      items: [createMockUser({ id: 'existing-tech', roleId: 'role-technician' })],
      nextCursor: undefined,
    });
    techRepo.getProfile.mockResolvedValue({ userId: 'existing-tech', status: 'active' });
    commissionRepo.getLatest.mockResolvedValue(null);

    await service.onModuleInit();

    expect(commissionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'existing-tech',
        baseRatePct: 40,
        creditCardFeePct: 3,
        achFeePct: 0,
      }),
    );
  });

  it('does not overwrite an existing commission config on init', async () => {
    usersRepo.findByRole.mockResolvedValue({
      items: [createMockUser({ id: 'existing-tech', roleId: 'role-technician' })],
      nextCursor: undefined,
    });
    techRepo.getProfile.mockResolvedValue({ userId: 'existing-tech', status: 'active' });
    commissionRepo.getLatest.mockResolvedValue({ userId: 'existing-tech', baseRatePct: 50 });

    await service.onModuleInit();
    expect(commissionRepo.create).not.toHaveBeenCalled();
  });

  it('module init never throws even if the backfill query fails', async () => {
    usersRepo.findByRole.mockRejectedValue(new Error('dynamo down'));
    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('provisions on assignRole to technician', async () => {
    usersRepo.findById.mockResolvedValue(createMockUser({ id: 'u9', roleId: 'role-read-only' }));
    usersRepo.update.mockResolvedValue(createMockUser({ id: 'u9', roleId: 'role-technician' }));

    await service.assignRole('u9', 'role-technician', createMockJwtUser({ id: 'caller', roleId: 'role-super-admin' }));

    expect(techRepo.upsertProfile).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u9', status: 'pending' }),
    );
  });
});
