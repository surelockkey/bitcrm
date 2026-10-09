import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
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
      findAll: jest.fn(),
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
      providers: [
        { provide: UsersService, useValue: service },
        // The dial-in PIN lives on its own service so the credential never
        // passes through UsersService (and so `toUser` can keep excluding it).
      ],
    }).compile();

    controller = module.get(UsersController);
  });

  it('getMe should return success wrapper with user data', async () => {
    const user = createMockUser();
    const caller = createMockJwtUser();
    service.findCurrentUser.mockResolvedValue(user);
    service.getResolvedPermissions.mockRejectedValue(new Error('no role'));

    const result = await controller.getMe(caller);

    expect(result).toEqual({ success: true, data: user });
    expect(service.findCurrentUser).toHaveBeenCalledWith(caller);
  });

  /**
   * The web resolved the caller's permissions from a hard-coded copy of the
   * seeded roles, so an edit in the role editor reached the server but never
   * the screens, and a custom role was shown the Read Only UI. `/me` now
   * carries the matrix the server itself enforces (role + overrides, the same
   * resolver and cache the guards use), so the web can gate by it.
   */
  it('getMe carries the caller\'s resolved permissions — role + overrides, as the guards see them', async () => {
    const user = createMockUser();
    const caller = createMockJwtUser();
    const resolved = {
      roleId: user.roleId,
      roleName: 'Night Desk',
      isSystemRole: false,
      permissions: { deals: { view: true, edit: false } },
      dataScope: { deals: 'assigned_only' },
      dealStageTransitions: [],
      hasOverrides: false,
    };
    service.findCurrentUser.mockResolvedValue(user);
    service.getResolvedPermissions.mockResolvedValue(resolved);

    const result = await controller.getMe(caller);

    expect(result).toEqual({ success: true, data: { ...user, resolvedPermissions: resolved } });
    expect(service.getResolvedPermissions).toHaveBeenCalledWith(user.id);
  });

  it('getMe still answers when the permissions cannot be resolved (the web falls back to its seed copy)', async () => {
    const user = createMockUser();
    service.findCurrentUser.mockResolvedValue(user);
    service.getResolvedPermissions.mockRejectedValue(new Error('role gone'));

    const result = await controller.getMe(createMockJwtUser());

    expect(result).toEqual({ success: true, data: user });
    expect(result.data).not.toHaveProperty('resolvedPermissions');
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

  it('internalListAll should coerce limit to int and return { items, nextCursor } wrapper', async () => {
    const page = { items: [createMockUser()], nextCursor: 'next-cursor' };
    service.findAll.mockResolvedValue(page);

    const result = await controller.internalListAll('50', 'cur-1');

    expect(result).toEqual({ success: true, data: page });
    expect(service.findAll).toHaveBeenCalledWith(50, 'cur-1');
  });

  it('internalListAll should default limit to 200 when not provided', async () => {
    service.findAll.mockResolvedValue({ items: [], nextCursor: undefined });

    await controller.internalListAll(undefined, undefined);

    expect(service.findAll).toHaveBeenCalledWith(200, undefined);
  });

  it('internalListAll should fall back to 200 for a non-numeric limit', async () => {
    service.findAll.mockResolvedValue({ items: [], nextCursor: undefined });

    await controller.internalListAll('abc', undefined);

    expect(service.findAll).toHaveBeenCalledWith(200, undefined);
  });

  it('internalListAll should clamp limit to a max of 500', async () => {
    service.findAll.mockResolvedValue({ items: [], nextCursor: undefined });

    await controller.internalListAll('9999', undefined);

    expect(service.findAll).toHaveBeenCalledWith(500, undefined);
  });

  it('internalFindById should return success wrapper with user data', async () => {
    const user = createMockUser();
    service.findById.mockResolvedValue(user);

    const result = await controller.internalFindById('user-1');

    expect(result).toEqual({ success: true, data: user });
    expect(service.findById).toHaveBeenCalledWith('user-1');
  });

  it('internalFindById should throw NotFoundException when the user is missing', async () => {
    service.findById.mockResolvedValue(null);

    await expect(controller.internalFindById('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('resolvePermissions (internal) should return data directly', async () => {
    const resolved = { permissions: { deals: { view: true } }, hasOverrides: false };
    service.getResolvedPermissions.mockResolvedValue(resolved);

    const result = await controller.resolvePermissions('user-1');

    expect(result).toEqual(resolved);
    expect(service.getResolvedPermissions).toHaveBeenCalledWith('user-1');
  });
});
