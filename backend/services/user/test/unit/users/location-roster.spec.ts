import 'reflect-metadata';
import { PERMISSION_KEY } from '@bitcrm/shared';
import { UsersService } from 'src/users/users.service';
import { UsersController } from 'src/users/users.controller';

/**
 * Inventory → User locations: whose van is whose. A role that works the
 * inventory but must not see the user directory (the owner's Logistics:
 * "no viewing users") still has to see WHO to give a van to. The roster is
 * that and nothing more — the active people, by name and role — opened by
 * the van switch (`containers.view`), not by `users.view`.
 */
describe('UsersService.locationRoster', () => {
  const users = [
    { id: 'u-2', firstName: 'Zoe', lastName: 'Ward', email: 'z@x.com', phone: '+14045550112', roleId: 'role-technician', status: 'active', department: 'Field' },
    { id: 'u-1', firstName: 'Bohdan', lastName: 'TECH', workizName: 'Bohdan TECH', email: 'b@x.com', phone: '+380631561365', roleId: 'role-technician', status: 'active' },
    { id: 'u-3', firstName: 'Gone', lastName: 'Away', email: 'g@x.com', roleId: 'role-dispatcher', status: 'inactive' },
  ];

  function makeService() {
    const repository = {
      allUsersIndexReady: jest.fn().mockResolvedValue(true),
      findAllIndexed: jest.fn().mockResolvedValue({ items: users }),
      findAll: jest.fn(),
    };
    const service = new UsersService(
      repository as never,
      { getUser: jest.fn(), setUser: jest.fn(), invalidateUser: jest.fn() } as never,
      {} as never,
      {} as never,
      { findById: jest.fn() } as never,
      { invalidateUserPermissions: jest.fn() } as never,
      {} as never,
    );
    return { service };
  }

  it('lists the active people by name, with their role — and nothing else', async () => {
    const { service } = makeService();

    await expect(service.locationRoster()).resolves.toEqual([
      { id: 'u-1', firstName: 'Bohdan', lastName: 'TECH', workizName: 'Bohdan TECH', roleId: 'role-technician' },
      { id: 'u-2', firstName: 'Zoe', lastName: 'Ward', roleId: 'role-technician' },
    ]);
  });

  it('is opened by the van switch (containers.view), not by the user directory', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, UsersController.prototype.locationRoster)).toEqual({
      resource: 'containers',
      action: 'view',
    });
  });
});
