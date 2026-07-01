import { DataScope } from '@bitcrm/types';
import { reconcileRolePermissions } from '../../../src/roles/reconcile-role-permissions';

describe('reconcileRolePermissions', () => {
  const def = {
    permissions: {
      deals: { view: true, create: true, edit: true, delete: true },
      technicians: { view: true, create: true, edit: true, delete: true },
      skills: { view: true, propose: false, approve: true, revoke: true },
    },
    dataScope: {
      deals: DataScope.ALL,
      technicians: DataScope.ALL,
      skills: DataScope.ALL,
    },
  };

  it('adds resources present in the default but missing from the role', () => {
    const role = {
      permissions: { deals: { view: true, create: false, edit: false, delete: false } },
      dataScope: { deals: DataScope.DEPARTMENT },
    };
    const result = reconcileRolePermissions(role, def);

    expect(result.changed).toBe(true);
    expect(result.permissions.technicians).toEqual({
      view: true,
      create: true,
      edit: true,
      delete: true,
    });
    expect(result.permissions.skills).toEqual(def.permissions.skills);
    expect(result.dataScope.technicians).toBe(DataScope.ALL);
  });

  it('never overwrites an existing resource entry (preserves manual edits)', () => {
    const role = {
      permissions: {
        deals: { view: true, create: false, edit: false, delete: false },
        technicians: { view: true, create: false, edit: false, delete: false },
        skills: { view: true, propose: false, approve: false, revoke: false },
      },
      dataScope: {
        deals: DataScope.DEPARTMENT,
        technicians: DataScope.DEPARTMENT,
        skills: DataScope.DEPARTMENT,
      },
    };
    const result = reconcileRolePermissions(role, def);

    expect(result.changed).toBe(false);
    // existing (more restrictive) technicians entry is kept, NOT replaced by def
    expect(result.permissions.technicians.edit).toBe(false);
    expect(result.dataScope.technicians).toBe(DataScope.DEPARTMENT);
  });

  it('reports changed=false when nothing is missing', () => {
    const role = { permissions: { ...def.permissions }, dataScope: { ...def.dataScope } };
    expect(reconcileRolePermissions(role, def).changed).toBe(false);
  });

  it('backfills dataScope even when permissions already cover the resource', () => {
    const role = {
      permissions: { ...def.permissions },
      dataScope: { deals: DataScope.ALL }, // missing technicians + skills scope
    };
    const result = reconcileRolePermissions(role, def);
    expect(result.changed).toBe(true);
    expect(result.dataScope.skills).toBe(DataScope.ALL);
  });
});
