import { Test } from '@nestjs/testing';
import { UsersController } from '../../../src/users/users.controller';
import { UsersService } from '../../../src/users/users.service';
import {
  createMockUser,
  createMockJwtUser,
  createMockCreateUserDto,
  createMockUpdateUserDto,
} from '../mocks';

describe('UsersController', () => {
  let controller: UsersController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      findCurrentUser: jest.fn(),
      create: jest.fn(),
      list: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      deactivate: jest.fn(),
      reactivate: jest.fn(),
      assignRole: jest.fn(),
      setPermissionOverrides: jest.fn(),
      getResolvedPermissions: jest.fn(),
      clearPermissionOverrides: jest.fn(),
    };

    const module = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: service }],
    }).compile();

    controller = module.get(UsersController);
  });

  it('getMe should return success wrapper with user data', async () => {
    const user = createMockUser();
    const caller = createMockJwtUser();
    service.findCurrentUser.mockResolvedValue(user);

    const result = await controller.getMe(caller);

    expect(result).toEqual({ success: true, data: user });
    expect(service.findCurrentUser).toHaveBeenCalledWith(caller);
  });

  it('create should pass dto and caller, return success wrapper', async () => {
    const user = createMockUser();
    const caller = createMockJwtUser();
    const dto = createMockCreateUserDto();
    service.create.mockResolvedValue(user);

    const result = await controller.create(dto, caller);

    expect(result).toEqual({ success: true, data: user });
    expect(service.create).toHaveBeenCalledWith(dto, caller);
  });

  it('list should return service result directly', async () => {
    const listResult = {
      success: true,
      data: [createMockUser()],
      pagination: { nextCursor: undefined, count: 1 },
    };
    service.list.mockResolvedValue(listResult);

    const result = await controller.list({} as never);

    expect(result).toEqual(listResult);
  });

  it('findById should return success wrapper with user data', async () => {
    const user = createMockUser();
    service.findById.mockResolvedValue(user);

    const result = await controller.findById('user-1');

    expect(result).toEqual({ success: true, data: user });
  });

  it('update should pass id, dto, and caller, return success wrapper', async () => {
    const user = createMockUser({ firstName: 'Updated' });
    const caller = createMockJwtUser();
    const dto = createMockUpdateUserDto({ firstName: 'Updated' });
    service.update.mockResolvedValue(user);

    const result = await controller.update('user-1', dto, caller);

    expect(result).toEqual({ success: true, data: user });
    expect(service.update).toHaveBeenCalledWith('user-1', dto, caller);
  });

  it('deactivate should return success wrapper with null data', async () => {
    const caller = createMockJwtUser();
    service.deactivate.mockResolvedValue(undefined);

    const result = await controller.deactivate('user-1', caller);

    expect(result).toEqual({ success: true, data: null });
  });

  it('reactivate should return success wrapper with null data', async () => {
    const caller = createMockJwtUser();
    service.reactivate.mockResolvedValue(undefined);

    const result = await controller.reactivate('user-1', caller);

    expect(result).toEqual({ success: true, data: null });
  });

  it('assignRole should pass id, roleId, and caller, return success wrapper', async () => {
    const user = createMockUser({ roleId: 'role-new' });
    const caller = createMockJwtUser();
    service.assignRole.mockResolvedValue(user);

    const result = await controller.assignRole('user-1', { roleId: 'role-new' } as any, caller);

    expect(result).toEqual({ success: true, data: user });
    expect(service.assignRole).toHaveBeenCalledWith('user-1', 'role-new', caller);
  });

  it('setPermissionOverrides should pass id, dto, and caller, return success wrapper', async () => {
    const user = createMockUser({ permissionOverrides: { deals: { view: false } } as any });
    const caller = createMockJwtUser();
    const dto = { permissions: { deals: { view: false } } } as any;
    service.setPermissionOverrides.mockResolvedValue(user);

    const result = await controller.setPermissionOverrides('user-1', dto, caller);

    expect(result).toEqual({ success: true, data: user });
    expect(service.setPermissionOverrides).toHaveBeenCalledWith('user-1', dto, caller);
  });

  it('getResolvedPermissions should return success wrapper with resolved data', async () => {
    const resolved = { permissions: { deals: { view: true } }, hasOverrides: false };
    service.getResolvedPermissions.mockResolvedValue(resolved);

    const result = await controller.getResolvedPermissions('user-1');

    expect(result).toEqual({ success: true, data: resolved });
    expect(service.getResolvedPermissions).toHaveBeenCalledWith('user-1');
  });

  it('clearPermissionOverrides should pass id and caller, return success wrapper', async () => {
    const user = createMockUser({ permissionOverrides: undefined });
    const caller = createMockJwtUser();
    service.clearPermissionOverrides.mockResolvedValue(user);

    const result = await controller.clearPermissionOverrides('user-1', caller);

    expect(result).toEqual({ success: true, data: user });
    expect(service.clearPermissionOverrides).toHaveBeenCalledWith('user-1', caller);
  });

  it('resolvePermissions (internal) should return data directly', async () => {
    const resolved = { permissions: { deals: { view: true } }, hasOverrides: false };
    service.getResolvedPermissions.mockResolvedValue(resolved);

    const result = await controller.resolvePermissions('user-1');

    expect(result).toEqual(resolved);
    expect(service.getResolvedPermissions).toHaveBeenCalledWith('user-1');
  });
});
