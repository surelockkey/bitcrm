import { RESOURCE_REGISTRY } from '@bitcrm/types';
import { DEFAULT_ROLES } from '../../../src/roles/constants/default-roles';

describe('DEFAULT_ROLES <-> RESOURCE_REGISTRY consistency', () => {
  const resources = Object.keys(RESOURCE_REGISTRY) as Array<
    keyof typeof RESOURCE_REGISTRY
  >;

  it('registers the technician-lifecycle resources', () => {
    expect(RESOURCE_REGISTRY.technicians).toEqual([
      'view',
      'create',
      'edit',
      'delete',
    ]);
    expect(RESOURCE_REGISTRY.skills).toEqual([
      'view',
      'propose',
      'approve',
      'revoke',
    ]);
    expect(RESOURCE_REGISTRY.commission).toEqual(['view', 'edit']);
    expect(RESOURCE_REGISTRY.documents).toEqual(['view', 'upload', 'delete']);
  });

  it('grants document permissions per the sensitive-data policy', () => {
    const byId = (id: string) => DEFAULT_ROLES.find((r) => r.id === id)!;
    // technician: uploads + views own; cannot delete
    expect(byId('role-technician').permissions.documents).toMatchObject({
      view: true,
      upload: true,
      delete: false,
    });
    // admin: views + deletes; super admin all
    expect(byId('role-admin').permissions.documents).toMatchObject({ view: true, delete: true });
    expect(byId('role-super-admin').permissions.documents).toMatchObject({
      view: true,
      upload: true,
      delete: true,
    });
    // dispatcher must NOT see sensitive documents
    expect(byId('role-dispatcher').permissions.documents?.view).toBe(false);
  });

  it.each(DEFAULT_ROLES.map((r) => [r.name, r] as const))(
    'role "%s" declares a permission + dataScope entry for every registered resource',
    (_name, role) => {
      for (const resource of resources) {
        const perms = role.permissions[resource];
        expect(perms).toBeDefined();
        for (const action of RESOURCE_REGISTRY[resource]) {
          expect(typeof perms![action as keyof typeof perms]).toBe('boolean');
        }
        expect(role.dataScope[resource]).toBeDefined();
      }
    },
  );

  it('grants the Technician role self-service skill + commission visibility', () => {
    const tech = DEFAULT_ROLES.find((r) => r.id === 'role-technician')!;
    expect(tech.permissions.technicians).toMatchObject({
      view: true,
      edit: true,
    });
    expect(tech.permissions.skills?.propose).toBe(true);
    expect(tech.permissions.skills?.approve).toBe(false);
    expect(tech.permissions.commission?.view).toBe(true);
    expect(tech.permissions.commission?.edit).toBe(false);
  });

  it('grants Manager/Admin skill approval + commission edit', () => {
    for (const id of ['role-super-admin', 'role-admin']) {
      const role = DEFAULT_ROLES.find((r) => r.id === id)!;
      expect(role.permissions.skills?.approve).toBe(true);
      expect(role.permissions.skills?.revoke).toBe(true);
      expect(role.permissions.commission?.edit).toBe(true);
      expect(role.permissions.technicians?.delete).toBe(true);
    }
  });

  it('makes Department Manager a TIER-3 manager (approves skills, sets commission, no hard delete)', () => {
    const dm = DEFAULT_ROLES.find((r) => r.id === 'role-dept-manager')!;
    expect(dm.priority).toBe(60);
    expect(dm.isSystem).toBe(true);
    expect(dm.permissions.skills?.approve).toBe(true);
    expect(dm.permissions.skills?.revoke).toBe(true);
    expect(dm.permissions.commission?.edit).toBe(true);
    expect(dm.permissions.technicians).toMatchObject({ view: true, edit: true, delete: false });
    // department-scoped, not global
    expect(dm.dataScope.technicians).toBe('department');
  });
});
