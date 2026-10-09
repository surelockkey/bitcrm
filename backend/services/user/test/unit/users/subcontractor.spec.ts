import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CognitoAdminService, PermissionCacheReader } from '@bitcrm/shared';
import { isSubcontractor, UserStatus } from '@bitcrm/types';
import { UsersService } from '../../../src/users/users.service';
import { UsersRepository } from '../../../src/users/users.repository';
import { UsersCacheService } from '../../../src/users/users-cache.service';
import { RolesService } from '../../../src/roles/roles.service';
import { RolesCacheService } from '../../../src/roles/roles-cache.service';
import { PermissionResolverService } from '../../../src/roles/permission-resolver.service';
import { TechniciansRepository } from '../../../src/technicians/technicians.repository';
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
  createMockTechnicianProfile,
} from '../mocks';

jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomUUID: () => 'generated-uuid',
}));

/**
 * Workiz's "User type": a User logs in (a paid seat); a Subcontractor is free,
 * "can not login, can take jobs and get messages" (Add team member pane), has
 * no role ("Roles are not available for subcontractors"), no location tracking
 * and no two-factor sign-in (the switches are greyed on their user page).
 * docs/import/app-parity-2026-10-08/subcontractor.md in workiz-data-parser.
 */
describe('isSubcontractor', () => {
  it('is the user type, and a record without one is a User', () => {
    expect(isSubcontractor({ userType: 'subcontractor' })).toBe(true);
    expect(isSubcontractor({ userType: 'regular' })).toBe(false);
    expect(isSubcontractor({})).toBe(false);
    expect(isSubcontractor(null)).toBe(false);
  });
});

describe('UsersService → subcontractors', () => {
  let service: UsersService;
  let repository: ReturnType<typeof createMockUsersRepository>;
  let cognito: ReturnType<typeof createMockCognitoAdminService>;
  let flags: ReturnType<typeof createMockPermissionCacheReader>;
  let techRepo: ReturnType<typeof createMockTechniciansRepository>;

  const admin = createMockJwtUser({ id: 'caller-1', roleId: 'role-admin' });

  beforeEach(async () => {
    repository = createMockUsersRepository();
    cognito = createMockCognitoAdminService();
    flags = createMockPermissionCacheReader();
    techRepo = createMockTechniciansRepository();
    const roles = {
      findById: jest.fn().mockImplementation((id: string) => {
        const map: Record<string, unknown> = {
          'role-super-admin': createMockRole({ id: 'role-super-admin', name: 'Super Admin', priority: 100, isSystem: true }),
          'role-admin': createMockRole({ id: 'role-admin', name: 'Admin', priority: 80, isSystem: true }),
          'role-dispatcher': createMockRole({ id: 'role-dispatcher', name: 'Dispatcher', priority: 40 }),
          'role-technician': createMockRole({ id: 'role-technician', name: 'Technician', priority: 20 }),
        };
        if (map[id]) return Promise.resolve(map[id]);
        return Promise.reject(new NotFoundException());
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: repository },
        { provide: UsersCacheService, useValue: createMockUsersCacheService() },
        { provide: CognitoAdminService, useValue: cognito },
        { provide: PermissionCacheReader, useValue: flags },
        { provide: RolesService, useValue: roles },
        { provide: RolesCacheService, useValue: createMockRolesCacheService() },
        { provide: PermissionResolverService, useValue: createMockPermissionResolver() },
        { provide: TechniciansRepository, useValue: techRepo },
      ],
    }).compile();
    service = module.get(UsersService);

    repository.create.mockResolvedValue(undefined);
    repository.update.mockImplementation(async (id: string, attrs: object) =>
      createMockUser({ id, ...attrs }),
    );
    cognito.createUser.mockResolvedValue({ User: { Attributes: [{ Name: 'sub', Value: 'sub-new' }] } });
    cognito.disableUser.mockResolvedValue(undefined);
    cognito.enableUser.mockResolvedValue(undefined);
    techRepo.getProfile.mockResolvedValue(null);
  });

  describe('create', () => {
    it('makes an account nobody is invited to, then switches it off', async () => {
      const user = await service.create(
        createMockCreateUserDto({ userType: 'subcontractor' }),
        admin,
      );

      expect(cognito.createUser).toHaveBeenCalledWith(
        'new@example.com',
        expect.objectContaining({ 'custom:user_id': 'generated-uuid' }),
        { suppressInvite: true },
      );
      expect(cognito.disableUser).toHaveBeenCalledWith('sub-new');
      expect(user.userType).toBe('subcontractor');
      expect(user.status).toBe(UserStatus.ACTIVE);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ userType: 'subcontractor' }),
      );
    });

    it('gives no role to choose: a subcontractor is a technician (Workiz prints "Tech")', async () => {
      const user = await service.create(
        createMockCreateUserDto({ userType: 'subcontractor', roleId: 'role-dispatcher' }),
        admin,
      );
      expect(user.roleId).toBe('role-technician');
      expect(cognito.createUser).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ 'custom:role_id': 'role-technician' }),
        { suppressInvite: true },
      );
    });

    it('needs no role in the request at all', async () => {
      const dto = createMockCreateUserDto({ userType: 'subcontractor' });
      delete (dto as { roleId?: string }).roleId;
      const user = await service.create(dto, admin);
      expect(user.roleId).toBe('role-technician');
    });

    it('puts them on the field team, with a technician card that says Subcontractor', async () => {
      const user = await service.create(
        createMockCreateUserDto({ userType: 'subcontractor' }),
        admin,
      );
      expect(user.fieldTeamMember).toBe(true);
      expect(techRepo.upsertProfile).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'generated-uuid', technicianType: 'subcontractor' }),
      );
    });

    it('still invites a User by email, and writes no type for them', async () => {
      const user = await service.create(createMockCreateUserDto(), admin);
      expect(cognito.createUser).toHaveBeenCalledWith('new@example.com', expect.any(Object));
      expect(cognito.disableUser).not.toHaveBeenCalled();
      expect(user.userType).toBeUndefined();
    });
  });

  describe('changeUserType', () => {
    const employee = createMockUser({ id: 'u-1', cognitoSub: 'sub-1', roleId: 'role-technician' });
    const sub = createMockUser({
      id: 'u-1',
      cognitoSub: 'sub-1',
      roleId: 'role-technician',
      userType: 'subcontractor',
    });

    it('User → Subcontractor takes the login away at once: Cognito off and live sessions killed', async () => {
      repository.findById.mockResolvedValue(employee);

      const updated = await service.changeUserType('u-1', 'subcontractor', admin);

      expect(repository.update).toHaveBeenCalledWith('u-1', { userType: 'subcontractor' });
      expect(cognito.disableUser).toHaveBeenCalledWith('sub-1');
      expect(flags.setUserDisabled).toHaveBeenCalledWith('u-1');
      expect(updated.userType).toBe('subcontractor');
    });

    it('if the sign-in cannot be switched off, the person stays a User — nothing is written', async () => {
      repository.findById.mockResolvedValue(employee);
      cognito.disableUser.mockRejectedValue(new Error('Cognito is down'));

      await expect(service.changeUserType('u-1', 'subcontractor', admin)).rejects.toThrow('Cognito is down');
      expect(repository.update).not.toHaveBeenCalled();
      expect(techRepo.updateProfile).not.toHaveBeenCalled();
    });

    it('a new subcontractor is still made when Cognito will not switch the fresh account off', async () => {
      cognito.disableUser.mockRejectedValue(new Error('throttled'));
      const user = await service.create(createMockCreateUserDto({ userType: 'subcontractor' }), admin);
      expect(user.userType).toBe('subcontractor');
      expect(repository.create).toHaveBeenCalled();
    });

    it('keeps the technician card in step and stops tracking their location', async () => {
      repository.findById.mockResolvedValue(employee);
      techRepo.getProfile.mockResolvedValue(
        createMockTechnicianProfile({ userId: 'u-1', gpsTrackingEnabled: true }),
      );

      await service.changeUserType('u-1', 'subcontractor', admin);

      expect(techRepo.updateProfile).toHaveBeenCalledWith('u-1', {
        technicianType: 'subcontractor',
        gpsTrackingEnabled: false,
      });
    });

    it('Subcontractor → User gives the login back and sends the invitation', async () => {
      repository.findById.mockResolvedValue(sub);
      techRepo.getProfile.mockResolvedValue(createMockTechnicianProfile({ userId: 'u-1' }));

      await service.changeUserType('u-1', 'regular', admin);

      expect(repository.update).toHaveBeenCalledWith('u-1', { userType: 'regular' });
      expect(cognito.enableUser).toHaveBeenCalledWith('sub-1');
      expect(flags.removeUserDisabled).toHaveBeenCalledWith('u-1');
      expect(cognito.resendInvite).toHaveBeenCalledWith(sub.email);
      expect(techRepo.updateProfile).toHaveBeenCalledWith('u-1', { technicianType: 'regular' });
    });

    it('a User who already has a password is not failed by the invitation Cognito will not resend', async () => {
      repository.findById.mockResolvedValue(sub);
      cognito.resendInvite.mockRejectedValue(
        Object.assign(new Error('User is already confirmed'), { name: 'UnsupportedUserStateException' }),
      );
      await expect(service.changeUserType('u-1', 'regular', admin)).resolves.toBeDefined();
      expect(cognito.enableUser).toHaveBeenCalled();
    });

    it('a disabled subcontractor made a User stays signed out until reactivated', async () => {
      repository.findById.mockResolvedValue({ ...sub, status: UserStatus.INACTIVE });
      await service.changeUserType('u-1', 'regular', admin);
      expect(cognito.enableUser).not.toHaveBeenCalled();
      expect(flags.removeUserDisabled).not.toHaveBeenCalled();
      expect(cognito.resendInvite).not.toHaveBeenCalled();
    });

    it('does nothing when the type is already the one asked for', async () => {
      repository.findById.mockResolvedValue(sub);
      await service.changeUserType('u-1', 'subcontractor', admin);
      expect(repository.update).not.toHaveBeenCalled();
      expect(cognito.disableUser).not.toHaveBeenCalled();
    });

    it('nobody can lock themselves out', async () => {
      repository.findById.mockResolvedValue({ ...employee, id: 'caller-1' });
      await expect(service.changeUserType('caller-1', 'subcontractor', admin)).rejects.toThrow(
        ForbiddenException,
      );
      expect(cognito.disableUser).not.toHaveBeenCalled();
    });

    it('only someone who outranks the person may change it', async () => {
      repository.findById.mockResolvedValue({ ...employee, roleId: 'role-admin' });
      await expect(service.changeUserType('u-1', 'subcontractor', admin)).rejects.toThrow(
        ForbiddenException,
      );
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('update (PUT /users/:id)', () => {
    it('routes a type change through the login rules, before anything else is written', async () => {
      const employee = createMockUser({ id: 'u-1', cognitoSub: 'sub-1' });
      repository.findById.mockResolvedValue(employee);

      await service.update('u-1', { firstName: 'Tyler', userType: 'subcontractor' } as never, admin);

      expect(repository.update).toHaveBeenCalledWith('u-1', { firstName: 'Tyler' });
      expect(repository.update).toHaveBeenCalledWith('u-1', { userType: 'subcontractor' });
      expect(cognito.disableUser).toHaveBeenCalledWith('sub-1');
    });

    it('refuses the whole edit when the type change is not allowed', async () => {
      repository.findById.mockResolvedValue(createMockUser({ id: 'u-1', roleId: 'role-admin' }));
      await expect(
        service.update('u-1', { firstName: 'X', userType: 'subcontractor' } as never, admin),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('the rest of the account', () => {
    const sub = createMockUser({ id: 'u-1', cognitoSub: 'sub-1', userType: 'subcontractor', status: UserStatus.INACTIVE });

    it('reactivating a subcontractor brings them back to the team, not to the sign-in page', async () => {
      repository.findById.mockResolvedValue(sub);
      await service.reactivate('u-1', admin);
      expect(repository.update).toHaveBeenCalledWith('u-1', { status: UserStatus.ACTIVE });
      expect(cognito.enableUser).not.toHaveBeenCalled();
      expect(flags.removeUserDisabled).not.toHaveBeenCalled();
    });

    it('has no invitation to resend', async () => {
      repository.findById.mockResolvedValue({ ...sub, status: UserStatus.ACTIVE });
      await expect(service.resendInvite('u-1')).rejects.toThrow(BadRequestException);
      expect(cognito.resendInvite).not.toHaveBeenCalled();
    });

    it('has no role to change', async () => {
      repository.findById.mockResolvedValue({ ...sub, status: UserStatus.ACTIVE });
      await expect(service.assignRole('u-1', 'role-dispatcher', admin)).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.update).not.toHaveBeenCalled();
    });
  });
});
