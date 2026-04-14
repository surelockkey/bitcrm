import { getDataScopeFilter } from '../../../src/auth/data-scope.util';
import { type ResolvedPermissions, DataScope } from '@bitcrm/types';

function makeResolvedPermissions(
  overrides: Partial<ResolvedPermissions> = {},
): ResolvedPermissions {
  return {
    roleId: 'role-1',
    roleName: 'Sales Manager',
    isSystemRole: false,
    permissions: {},
    dataScope: {},
    dealStageTransitions: [],
    hasOverrides: false,
    ...overrides,
  };
}

describe('getDataScopeFilter', () => {
  const user = { id: 'user-1', department: 'sales' };

  it('should return scope "all" with no filters when data scope is ALL', () => {
    const resolved = makeResolvedPermissions({
      dataScope: { deals: DataScope.ALL },
    });

    const result = getDataScopeFilter(user, 'deals', resolved);

    expect(result).toEqual({ scope: DataScope.ALL });
    expect(result.department).toBeUndefined();
    expect(result.userId).toBeUndefined();
  });

  it('should return scope "department" with department filter when data scope is DEPARTMENT', () => {
    const resolved = makeResolvedPermissions({
      dataScope: { deals: DataScope.DEPARTMENT },
    });

    const result = getDataScopeFilter(user, 'deals', resolved);

    expect(result).toEqual({
      scope: DataScope.DEPARTMENT,
      department: 'sales',
    });
  });

  it('should return scope "assigned_only" with userId filter when data scope is ASSIGNED_ONLY', () => {
    const resolved = makeResolvedPermissions({
      dataScope: { deals: DataScope.ASSIGNED_ONLY },
    });

    const result = getDataScopeFilter(user, 'deals', resolved);

    expect(result).toEqual({
      scope: DataScope.ASSIGNED_ONLY,
      userId: 'user-1',
    });
  });

  it('should default to "assigned_only" when resource is not in dataScope', () => {
    const resolved = makeResolvedPermissions({
      dataScope: { contacts: DataScope.ALL },
    });

    const result = getDataScopeFilter(user, 'deals', resolved);

    expect(result).toEqual({
      scope: DataScope.ASSIGNED_ONLY,
      userId: 'user-1',
    });
  });

  it('should always return scope "all" for Super Admin regardless of dataScope setting', () => {
    const resolved = makeResolvedPermissions({
      roleName: 'Super Admin',
      isSystemRole: true,
      dataScope: { deals: DataScope.ASSIGNED_ONLY },
    });

    const result = getDataScopeFilter(user, 'deals', resolved);

    expect(result).toEqual({ scope: DataScope.ALL });
    expect(result.department).toBeUndefined();
    expect(result.userId).toBeUndefined();
  });

  it('should always return scope "all" for Super Admin even when resource is missing from dataScope', () => {
    const resolved = makeResolvedPermissions({
      roleName: 'Super Admin',
      isSystemRole: true,
      dataScope: {},
    });

    const result = getDataScopeFilter(user, 'deals', resolved);

    expect(result).toEqual({ scope: DataScope.ALL });
  });
});
