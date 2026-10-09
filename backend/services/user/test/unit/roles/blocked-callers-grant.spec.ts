import { RESOURCE_REGISTRY } from '@bitcrm/types';
import { DEFAULT_ROLES } from '../../../src/roles/constants/default-roles';

/**
 * `calls.block` — Workiz Phone → Blocked callers: see the list, block a
 * number, unblock one. The office holds it; a technician and a read-only
 * viewer do not.
 */
describe('calls.block', () => {
  const byId = (id: string) => DEFAULT_ROLES.find((r) => r.id === id)!;

  it('is a registered action on calls', () => {
    expect(RESOURCE_REGISTRY.calls).toEqual(['view', 'join', 'block']);
  });

  it.each(['role-super-admin', 'role-admin', 'role-dept-manager', 'role-dispatcher'])('%s may block callers', (id) => {
    expect(byId(id).permissions.calls).toMatchObject({ block: true });
  });

  it.each(['role-technician', 'role-read-only'])('%s may not', (id) => {
    expect(byId(id).permissions.calls).toMatchObject({ block: false });
  });
});
