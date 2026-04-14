import { Test } from '@nestjs/testing';
import { RESOURCE_REGISTRY } from '@bitcrm/types';
import { RolesController } from '../../../src/roles/roles.controller';
import { RolesService } from '../../../src/roles/roles.service';
import { UsersRepository } from '../../../src/users/users.repository';
import { createMockRole, createMockUser } from '../mocks';

describe('RolesController', () => {
  let controller: RolesController;
  let rolesService: Record<string, jest.Mock>;
  let usersRepository: Record<string, jest.Mock>;

  beforeEach(async () => {
    rolesService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    usersRepository = {
      findByRoleId: jest.fn(),
    };

    const module = await Test.createTestingModule({
      controllers: [RolesController],
      providers: [
        { provide: RolesService, useValue: rolesService },
        { provide: UsersRepository, useValue: usersRepository },
      ],
    }).compile();

    controller = module.get(RolesController);
  });

  it('create should pass dto and return success wrapper', async () => {
    const role = createMockRole();
    const dto = { name: 'New Role', permissions: {}, dataScope: {}, dealStageTransitions: [], priority: 40 } as any;
    rolesService.create.mockResolvedValue(role);

    const result = await controller.create(dto);

    expect(result).toEqual({ success: true, data: role });
    expect(rolesService.create).toHaveBeenCalledWith(dto);
  });

  it('findAll should return success wrapper with all roles', async () => {
    const roles = [createMockRole(), createMockRole({ id: 'role-2', name: 'Role 2' })];
    rolesService.findAll.mockResolvedValue(roles);

    const result = await controller.findAll();

    expect(result).toEqual({ success: true, data: roles });
    expect(rolesService.findAll).toHaveBeenCalled();
  });

  it('getSchema should return success wrapper with RESOURCE_REGISTRY', async () => {
    const result = await controller.getSchema();

    expect(result).toEqual({ success: true, data: RESOURCE_REGISTRY });
  });

  it('findById should return success wrapper with role data', async () => {
    const role = createMockRole();
    rolesService.findById.mockResolvedValue(role);

    const result = await controller.findById('role-1');

    expect(result).toEqual({ success: true, data: role });
    expect(rolesService.findById).toHaveBeenCalledWith('role-1');
  });

  it('update should pass id and dto, return success wrapper', async () => {
    const role = createMockRole({ description: 'Updated' });
    const dto = { description: 'Updated' } as any;
    rolesService.update.mockResolvedValue(role);

    const result = await controller.update('role-1', dto);

    expect(result).toEqual({ success: true, data: role });
    expect(rolesService.update).toHaveBeenCalledWith('role-1', dto);
  });

  it('delete should return success wrapper with null data', async () => {
    rolesService.delete.mockResolvedValue(undefined);

    const result = await controller.delete('role-1');

    expect(result).toEqual({ success: true, data: null });
    expect(rolesService.delete).toHaveBeenCalledWith('role-1');
  });

  it('findUsersByRole should verify role exists then return users', async () => {
    const role = createMockRole();
    const users = [createMockUser(), createMockUser({ id: 'user-2' })];
    rolesService.findById.mockResolvedValue(role);
    usersRepository.findByRoleId.mockResolvedValue(users);

    const result = await controller.findUsersByRole('role-1');

    expect(result).toEqual({ success: true, data: users });
    expect(rolesService.findById).toHaveBeenCalledWith('role-1');
    expect(usersRepository.findByRoleId).toHaveBeenCalledWith('role-1');
  });
});
