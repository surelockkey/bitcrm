import { PermissionResolverService } from '../../../src/roles/permission-resolver.service';
import { type Role, type UserPermissionOverrides, DataScope } from '@bitcrm/types';

describe('PermissionResolverService', () => {
  let resolver: PermissionResolverService;

  const baseRole: Role = {
    id: 'role-1',
    name: 'Sales Manager',
    description: 'Manages sales team',
    permissions: {
      deals: { view: true, create: false, edit: true, delete: false },
      contacts: { view: true, create: true, edit: true, delete: false },
    },
    dataScope: {
      deals: DataScope.ALL,
      contacts: DataScope.DEPARTMENT,
    },
    dealStageTransitions: ['lead->qualified', '*->canceled'],
    isSystem: false,
    priority: 50,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const superAdminRole: Role = {
    id: 'role-sa',
    name: 'Super Admin',
    description: 'Full system access',
    permissions: {
      deals: { view: true, create: true, edit: true, delete: true },
      contacts: { view: true, create: true, edit: true, delete: true },
    },
    dataScope: {
      deals: DataScope.ALL,
      contacts: DataScope.ALL,
    },
    dealStageTransitions: ['*->*'],
    isSystem: true,
    priority: 100,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  beforeEach(() => {
    resolver = new PermissionResolverService();
  });

  it('should return role base as-is when no overrides', () => {
    const result = resolver.resolve(baseRole);

    expect(result.roleId).toBe(baseRole.id);
    expect(result.roleName).toBe(baseRole.name);
    expect(result.permissions).toEqual(baseRole.permissions);
    expect(result.dataScope).toEqual(baseRole.dataScope);
    expect(result.dealStageTransitions).toEqual(baseRole.dealStageTransitions);
  });

  describe('permission overrides', () => {
    it('should merge sparse permission overrides (user wins on conflict)', () => {
      const overrides: UserPermissionOverrides = {
        permissions: {
          deals: { create: true },
        },
      };

      const result = resolver.resolve(baseRole, overrides);

      // Override wins: deals.create was false, now true
      expect(result.permissions.deals.create).toBe(true);
      // Other deals permissions stay from role
      expect(result.permissions.deals.view).toBe(true);
      expect(result.permissions.deals.edit).toBe(true);
      expect(result.permissions.deals.delete).toBe(false);
    });

    it('should inherit resources not present in overrides', () => {
      const overrides: UserPermissionOverrides = {
        permissions: {
          deals: { create: true },
        },
      };

      const result = resolver.resolve(baseRole, overrides);

      // contacts not in overrides, should be fully inherited
      expect(result.permissions.contacts).toEqual(baseRole.permissions.contacts);
    });
  });

  describe('data scope overrides', () => {
    it('should merge data scope overrides (user wins)', () => {
      const overrides: UserPermissionOverrides = {
        dataScope: {
          deals: DataScope.ASSIGNED_ONLY,
        },
      };

      const result = resolver.resolve(baseRole, overrides);

      expect(result.dataScope.deals).toBe(DataScope.ASSIGNED_ONLY);
    });

    it('should inherit data scopes not present in overrides', () => {
      const overrides: UserPermissionOverrides = {
        dataScope: {
          deals: DataScope.ASSIGNED_ONLY,
        },
      };

      const result = resolver.resolve(baseRole, overrides);

      expect(result.dataScope.contacts).toBe(DataScope.DEPARTMENT);
    });
  });

  describe('deal stage transitions', () => {
    it('should fully replace stage transitions when override is set', () => {
      const overrides: UserPermissionOverrides = {
        dealStageTransitions: ['*->*'],
      };

      const result = resolver.resolve(baseRole, overrides);

      expect(result.dealStageTransitions).toEqual(['*->*']);
      expect(result.dealStageTransitions).not.toContain('lead->qualified');
    });

    it('should use role transitions when override is not set', () => {
      const overrides: UserPermissionOverrides = {
        permissions: { deals: { create: true } },
      };

      const result = resolver.resolve(baseRole, overrides);

      expect(result.dealStageTransitions).toEqual(baseRole.dealStageTransitions);
    });
  });

  it('should ignore unknown resources in override without breaking', () => {
    const overrides: UserPermissionOverrides = {
      permissions: {
        nonexistent_resource: { view: true },
      },
      dataScope: {
        nonexistent_resource: DataScope.ALL,
      },
    };

    expect(() => resolver.resolve(baseRole, overrides)).not.toThrow();

    const result = resolver.resolve(baseRole, overrides);
    expect(result.permissions.deals).toEqual(baseRole.permissions.deals);
    expect(result.permissions.contacts).toEqual(baseRole.permissions.contacts);
  });

  describe('hasOverrides flag', () => {
    it('should set hasOverrides=true when overrides are present', () => {
      const overrides: UserPermissionOverrides = {
        permissions: { deals: { create: true } },
      };

      const result = resolver.resolve(baseRole, overrides);

      expect(result.hasOverrides).toBe(true);
    });

    it('should set hasOverrides=false when no overrides', () => {
      const result = resolver.resolve(baseRole);

      expect(result.hasOverrides).toBe(false);
    });

    it('should set hasOverrides=false when overrides object is empty', () => {
      const overrides: UserPermissionOverrides = {};

      const result = resolver.resolve(baseRole, overrides);

      expect(result.hasOverrides).toBe(false);
    });
  });

  it('should return isSystemRole=true for Super Admin role', () => {
    const result = resolver.resolve(superAdminRole);

    expect(result.isSystemRole).toBe(true);
    expect(result.roleName).toBe('Super Admin');
  });

  it('should return isSystemRole=false for non-system roles', () => {
    const result = resolver.resolve(baseRole);

    expect(result.isSystemRole).toBe(false);
  });
});
