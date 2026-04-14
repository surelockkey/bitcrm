import {
  type Role,
  type UserPermissionOverrides,
  type ResolvedPermissions,
  DataScope,
} from '@bitcrm/types';
import { PermissionResolverService } from '../../src/roles/permission-resolver.service';

describe('PermissionResolverService (integration)', () => {
  let service: PermissionResolverService;

  const fullRole: Role = {
    id: 'role-admin',
    name: 'Admin',
    description: 'Full admin role',
    permissions: {
      deals: { view: true, create: true, edit: true, delete: true },
      users: { view: true, create: true, edit: true, delete: false },
      reports: { view: true, create: false, edit: false, delete: false },
      settings: { view: true, create: false, edit: true, delete: false },
    },
    dataScope: {
      deals: DataScope.ALL,
      users: DataScope.ALL,
      reports: DataScope.DEPARTMENT,
      settings: DataScope.ALL,
    },
    dealStageTransitions: ['*->*'],
    isSystem: false,
    priority: 80,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const technicianRole: Role = {
    id: 'role-tech',
    name: 'Technician',
    description: 'Field technician',
    permissions: {
      deals: { view: true, create: false, edit: false, delete: false },
      users: { view: false, create: false, edit: false, delete: false },
    },
    dataScope: {
      deals: DataScope.ASSIGNED_ONLY,
      users: DataScope.ASSIGNED_ONLY,
    },
    dealStageTransitions: ['in_progress->completed', 'in_progress->on_hold'],
    isSystem: false,
    priority: 10,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  beforeAll(() => {
    service = new PermissionResolverService();
  });

  describe('resolve without overrides', () => {
    it('should resolve full role with all resources correctly', () => {
      const result = service.resolve(fullRole, undefined);

      expect(result.roleId).toBe('role-admin');
      expect(result.roleName).toBe('Admin');
      expect(result.isSystemRole).toBe(false);
      expect(result.hasOverrides).toBe(false);
      expect(result.permissions).toEqual(fullRole.permissions);
      expect(result.dataScope).toEqual(fullRole.dataScope);
      expect(result.dealStageTransitions).toEqual(['*->*']);
    });

    it('should resolve restricted role correctly', () => {
      const result = service.resolve(technicianRole, undefined);

      expect(result.roleId).toBe('role-tech');
      expect(result.permissions.deals.view).toBe(true);
      expect(result.permissions.deals.create).toBe(false);
      expect(result.permissions.users.view).toBe(false);
      expect(result.dataScope.deals).toBe(DataScope.ASSIGNED_ONLY);
      expect(result.dealStageTransitions).toEqual([
        'in_progress->completed',
        'in_progress->on_hold',
      ]);
      expect(result.hasOverrides).toBe(false);
    });

    it('should mark system roles correctly', () => {
      const systemRole: Role = { ...fullRole, isSystem: true };
      const result = service.resolve(systemRole, undefined);

      expect(result.isSystemRole).toBe(true);
    });
  });

  describe('resolve with permission overrides', () => {
    it('should merge sparse permission overrides (user wins)', () => {
      const overrides: UserPermissionOverrides = {
        permissions: {
          deals: { delete: false }, // override: revoke delete
          reports: { create: true }, // override: grant create
        },
      };

      const result = service.resolve(fullRole, overrides);

      expect(result.hasOverrides).toBe(true);
      // Overridden fields
      expect(result.permissions.deals.delete).toBe(false);
      expect(result.permissions.reports.create).toBe(true);
      // Non-overridden fields preserved from role
      expect(result.permissions.deals.view).toBe(true);
      expect(result.permissions.deals.create).toBe(true);
      expect(result.permissions.deals.edit).toBe(true);
      expect(result.permissions.users).toEqual(fullRole.permissions.users);
      expect(result.permissions.settings).toEqual(fullRole.permissions.settings);
    });

    it('should grant permissions to restricted role via overrides', () => {
      const overrides: UserPermissionOverrides = {
        permissions: {
          deals: { create: true, edit: true },
        },
      };

      const result = service.resolve(technicianRole, overrides);

      expect(result.hasOverrides).toBe(true);
      expect(result.permissions.deals.view).toBe(true); // from role
      expect(result.permissions.deals.create).toBe(true); // overridden
      expect(result.permissions.deals.edit).toBe(true); // overridden
      expect(result.permissions.deals.delete).toBe(false); // from role
    });
  });

  describe('resolve with data scope overrides', () => {
    it('should merge data scope overrides (user wins)', () => {
      const overrides: UserPermissionOverrides = {
        dataScope: {
          reports: DataScope.ALL, // widen from DEPARTMENT to ALL
        },
      };

      const result = service.resolve(fullRole, overrides);

      expect(result.hasOverrides).toBe(true);
      expect(result.dataScope.reports).toBe(DataScope.ALL);
      // Non-overridden scopes preserved
      expect(result.dataScope.deals).toBe(DataScope.ALL);
      expect(result.dataScope.users).toBe(DataScope.ALL);
      expect(result.dataScope.settings).toBe(DataScope.ALL);
    });

    it('should narrow data scope via override', () => {
      const overrides: UserPermissionOverrides = {
        dataScope: {
          deals: DataScope.DEPARTMENT, // narrow from ALL to DEPARTMENT
        },
      };

      const result = service.resolve(fullRole, overrides);

      expect(result.dataScope.deals).toBe(DataScope.DEPARTMENT);
    });
  });

  describe('resolve with stage transition overrides', () => {
    it('should fully replace stage transitions when overridden', () => {
      const overrides: UserPermissionOverrides = {
        dealStageTransitions: ['lead->qualified', 'qualified->proposal'],
      };

      const result = service.resolve(fullRole, overrides);

      expect(result.hasOverrides).toBe(true);
      // Full replacement, not merge
      expect(result.dealStageTransitions).toEqual([
        'lead->qualified',
        'qualified->proposal',
      ]);
      // Original '*->*' is gone
      expect(result.dealStageTransitions).not.toContain('*->*');
    });

    it('should use role transitions when override is not set', () => {
      const overrides: UserPermissionOverrides = {
        permissions: { deals: { delete: true } },
        // no dealStageTransitions override
      };

      const result = service.resolve(technicianRole, overrides);

      expect(result.dealStageTransitions).toEqual(technicianRole.dealStageTransitions);
    });
  });

  describe('resolve with combined overrides', () => {
    it('should handle all override types together', () => {
      const overrides: UserPermissionOverrides = {
        permissions: {
          deals: { create: true },
        },
        dataScope: {
          deals: DataScope.ALL,
        },
        dealStageTransitions: ['*->*'],
      };

      const result = service.resolve(technicianRole, overrides);

      expect(result.hasOverrides).toBe(true);
      expect(result.permissions.deals.create).toBe(true);
      expect(result.dataScope.deals).toBe(DataScope.ALL);
      expect(result.dealStageTransitions).toEqual(['*->*']);
      // Non-overridden preserved
      expect(result.permissions.deals.view).toBe(true);
      expect(result.permissions.users).toEqual(technicianRole.permissions.users);
      expect(result.dataScope.users).toBe(DataScope.ASSIGNED_ONLY);
    });
  });

  describe('edge cases', () => {
    it('should handle empty overrides object', () => {
      const overrides: UserPermissionOverrides = {};
      const result = service.resolve(fullRole, overrides);

      // Empty overrides means no changes
      expect(result.permissions).toEqual(fullRole.permissions);
      expect(result.dataScope).toEqual(fullRole.dataScope);
      expect(result.dealStageTransitions).toEqual(fullRole.dealStageTransitions);
    });

    it('should handle override for resource not in role', () => {
      const overrides: UserPermissionOverrides = {
        permissions: {
          invoices: { view: true, create: true },
        },
      };

      const result = service.resolve(technicianRole, overrides);

      // New resource from override should be present
      expect(result.permissions.invoices).toEqual({ view: true, create: true });
      // Existing resources preserved
      expect(result.permissions.deals).toEqual(technicianRole.permissions.deals);
    });
  });
});
