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

  /**
   * Workiz's "Add team member" asks "Field tech — Can this user be assigned
   * to jobs" and "Track Location" up front (subcontractor_wz_04_add_new_user),
   * so the create request carries both: the first is the user's field-team
   * flag whatever the role, the second seeds the card that flag provisions.
   */
  describe('Field tech and Track Location on create', () => {
    const caller = createMockJwtUser({ roleId: 'role-super-admin' });

    it('puts a non-technician on the field team when Field tech is on, with the card tracking location when asked', async () => {
      const user = await service.create(
        createMockCreateUserDto({ roleId: 'role-admin', fieldTeamMember: true, gpsTrackingEnabled: true }),
        caller,
      );

      expect(user.fieldTeamMember).toBe(true);
      expect(usersRepo.create).toHaveBeenCalledWith(expect.objectContaining({ fieldTeamMember: true }));
      expect(techRepo.upsertProfile).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending', gpsTrackingEnabled: true }),
      );
    });

    it('keeps a technician off the roster when Field tech is off: no card', async () => {
      const user = await service.create(
        createMockCreateUserDto({ roleId: 'role-technician', fieldTeamMember: false, gpsTrackingEnabled: true }),
        caller,
      );

      expect(user.fieldTeamMember).toBe(false);
      expect(techRepo.upsertProfile).not.toHaveBeenCalled();
    });

    it('leaves the flag unset and the card untracked when the request says nothing', async () => {
      const user = await service.create(createMockCreateUserDto({ roleId: 'role-technician' }), caller);

      expect('fieldTeamMember' in user).toBe(false);
      expect(techRepo.upsertProfile).toHaveBeenCalledWith(expect.objectContaining({ gpsTrackingEnabled: false }));
    });

    it('a subcontractor is always on the field team and never tracked, whatever the request says', async () => {
      const user = await service.create(
        createMockCreateUserDto({ userType: 'subcontractor', fieldTeamMember: false, gpsTrackingEnabled: true }),
        caller,
      );

      expect(user.fieldTeamMember).toBe(true);
      expect(techRepo.upsertProfile).toHaveBeenCalledWith(
        expect.objectContaining({ technicianType: 'subcontractor', gpsTrackingEnabled: false }),
      );
    });
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

  it('provisions when someone is switched onto the field team, whatever their role', async () => {
    const owner = createMockUser({ id: 'owner-1', roleId: 'role-super-admin' });
    usersRepo.findById.mockResolvedValue(owner);
    usersRepo.update.mockResolvedValue({ ...owner, fieldTeamMember: true });

    await service.update('owner-1', { fieldTeamMember: true }, createMockJwtUser({ id: 'caller', roleId: 'role-super-admin' }));

    expect(usersRepo.update).toHaveBeenCalledWith('owner-1', expect.objectContaining({ fieldTeamMember: true }));
    expect(techRepo.upsertProfile).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'owner-1', status: 'pending' }),
    );
  });

  it('keeps the profile when someone is switched off the field team', async () => {
    const tech = createMockUser({ id: 'u9', roleId: 'role-technician' });
    usersRepo.findById.mockResolvedValue(tech);
    usersRepo.update.mockResolvedValue({ ...tech, fieldTeamMember: false });

    await service.update('u9', { fieldTeamMember: false }, createMockJwtUser({ id: 'caller', roleId: 'role-super-admin' }));

    expect(techRepo.upsertProfile).not.toHaveBeenCalled();
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
