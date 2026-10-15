import { RolesService } from '../../../src/roles/roles.service';
import { createMockJwtUser, createMockRole, createMockRolesRepository, createMockRolesCacheService } from '../mocks';

/** Creating, changing and deleting a role is recorded with who did it. */
describe('RolesService — admin audit trail', () => {
  const caller = createMockJwtUser({ id: 'u-admin' });
  const existing = createMockRole({
    id: 'role-x',
    name: 'Office',
    priority: 40,
    isSystem: false,
    permissions: { contacts: { view: true, view_numbers: false } } as never,
  });

  function make() {
    const repo = createMockRolesRepository();
    const usersRepo = {
      findByRoleId: jest.fn(async () => []),
      findByRole: jest.fn(async () => ({ items: [] })),
    };
    const audit = { record: jest.fn(async () => undefined) };
    const service = new RolesService(repo as never, createMockRolesCacheService() as never, usersRepo as never, audit as never);
    return { service, repo, audit };
  }

  it('update: records each permission flipped and each field changed', async () => {
    const { service, repo, audit } = make();
    repo.findById.mockResolvedValue(existing);
    repo.update.mockImplementation(async (_id: string, dto: object) => ({ ...existing, ...dto }));

    await service.update(
      'role-x',
      { name: 'Office', permissions: { contacts: { view: true, view_numbers: true } } } as never,
      caller,
    );

    expect(audit.record).toHaveBeenCalledWith(caller, 'role.updated', { type: 'role', id: 'role-x', label: 'Office' }, {
      'permissions.contacts.view_numbers': { from: false, to: true },
    });
  });

  it('delete: recorded, with the role as it was', async () => {
    const { service, repo, audit } = make();
    repo.findById.mockResolvedValue(existing);

    await service.delete('role-x', caller);

    expect(audit.record).toHaveBeenCalledWith(caller, 'role.deleted', { type: 'role', id: 'role-x', label: 'Office' });
  });

  it('create: recorded', async () => {
    const { service, repo, audit } = make();
    repo.findByName.mockResolvedValue(null);
    repo.create.mockResolvedValue(undefined);

    const role = await service.create(
      { name: 'Night', permissions: {}, dataScope: {}, dealStageTransitions: [], priority: 30 },
      caller,
    );

    expect(audit.record).toHaveBeenCalledWith(
      caller,
      'role.created',
      { type: 'role', id: role.id, label: 'Night' },
      expect.objectContaining({ priority: { to: 30 } }),
    );
  });

  it('a refused change records nothing', async () => {
    const { service, repo, audit } = make();
    repo.findById.mockResolvedValue({ ...existing, isSystem: true });
    await expect(service.delete('role-x', caller)).rejects.toThrow();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
